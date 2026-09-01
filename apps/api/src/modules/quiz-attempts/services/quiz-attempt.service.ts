import { parseStageDocument, type QuizQuestion } from '@chalk/chalkboard';

import type { Database } from '../../../db/client';
import { createQuizAttemptsDal } from '../../../db/dal';
import { ApiError } from '../../../http/errors';
import type { SaveQuizAttemptInput } from '../schemas';
import type { MemoryService } from '../../memory/services/memory.service';

type QuizResult = {
  questionId: string;
  correct: boolean | null;
  awardedPoints: number | null;
  maxPoints: number | null;
};

export class QuizAttemptService {
  private readonly attempts;

  constructor(db: Database, private readonly memory?: MemoryService) {
    this.attempts = createQuizAttemptsDal(db);
  }

  async list(userId: string, learningSessionId: string) {
    const rows = await this.attempts.list(userId, learningSessionId);
    return { quizAttempts: rows.map(projectQuizAttempt) };
  }

  async save(
    userId: string,
    learningSessionId: string,
    sceneId: string,
    input: SaveQuizAttemptInput,
  ) {
    const context = await this.attempts.getSessionContext(userId, learningSessionId);
    if (context.document === null) {
      throw new ApiError(422, 'Quiz scene is not available in this classroom artifact', 'QUIZ_SCENE_INVALID');
    }
    const scored = scoreAttempt(context.document, sceneId, input.answers);
    const result = await this.attempts.save(userId, {
      learningSessionId,
      classroomId: context.session.classroomId,
      artifactId: context.session.artifactId,
      sceneId,
      expectedRevision: input.expectedRevision,
      ...scored,
    });
    if (!result) {
      throw new ApiError(
        409,
        'Quiz attempt has a newer saved revision',
        'QUIZ_ATTEMPT_CONFLICT',
      );
    }
    await this.memory?.appendEvent(userId, {
      surface: 'quiz', kind: 'attempt_submitted',
      payload: { learningSessionId, sceneId, score: result.row.score, maxScore: result.row.maxScore, results: result.row.results },
      sourceType: 'quiz_attempt', sourceId: result.row.id,
    }).catch(() => undefined);
    return { quizAttempt: projectQuizAttempt(result.row), created: result.created };
  }
}

function scoreAttempt(document: unknown, sceneId: string, submitted: Record<string, string[]>) {
  const classroom = parseStageDocument(document);
  const scene = classroom.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene || scene.type !== 'quiz' || !Array.isArray(scene.content.questions)) {
    throw new ApiError(422, 'Quiz scene is not available in this classroom artifact', 'QUIZ_SCENE_INVALID');
  }
  const questions = scene.content.questions as QuizQuestion[];
  if (questions.length === 0 || new Set(questions.map((question) => question.id)).size !== questions.length) {
    throw new ApiError(422, 'Quiz scene cannot accept attempts', 'QUIZ_SCENE_INVALID');
  }
  const questionIds = new Set(questions.map((question) => question.id));
  if (Object.keys(submitted).some((questionId) => !questionIds.has(questionId))) {
    throw new ApiError(422, 'Quiz answers do not match this quiz scene', 'QUIZ_ANSWERS_INVALID');
  }

  const answers: Record<string, string[]> = {};
  const results: QuizResult[] = [];
  let score = 0;
  let maxScore = 0;
  for (const question of questions) {
    const values = normalizeAnswer(question, submitted[question.id]);
    answers[question.id] = values;
    const points = Number.isInteger(question.points) && (question.points ?? 0) >= 0
      ? question.points ?? 1
      : 1;
    if (!Array.isArray(question.answer)) {
      results.push({ questionId: question.id, correct: null, awardedPoints: null, maxPoints: null });
      continue;
    }
    maxScore += points;
    const correct = equalAnswers(values, question.answer);
    const awardedPoints = correct ? points : 0;
    score += awardedPoints;
    results.push({ questionId: question.id, correct, awardedPoints, maxPoints: points });
  }
  return { answers, results, score, maxScore };
}

function normalizeAnswer(question: QuizQuestion, submitted: string[] | undefined) {
  if (!Array.isArray(submitted) || submitted.length === 0) {
    throw new ApiError(422, 'Complete every quiz question before submitting', 'QUIZ_ATTEMPT_INCOMPLETE');
  }
  if (question.type === 'short_answer') {
    const value = submitted.length === 1 ? submitted[0]?.trim() : '';
    if (!value) {
      throw new ApiError(422, 'Complete every quiz question before submitting', 'QUIZ_ATTEMPT_INCOMPLETE');
    }
    return [value];
  }
  const optionValues = new Set((question.options ?? []).map((option) => option.value));
  const unique = [...new Set(submitted)];
  if (
    unique.length !== submitted.length
    || unique.some((value) => !optionValues.has(value))
    || (question.type === 'single' && unique.length !== 1)
  ) {
    throw new ApiError(422, 'Quiz answers do not match this quiz scene', 'QUIZ_ANSWERS_INVALID');
  }
  return unique;
}

function equalAnswers(actual: readonly string[], expected: readonly string[]) {
  return [...actual].sort().join('\u0000') === [...expected].sort().join('\u0000');
}

function projectQuizAttempt(row: typeof import('../../../db/schema').classroomQuizAttempts.$inferSelect) {
  return {
    id: row.id,
    learningSessionId: row.learningSessionId,
    classroomId: row.classroomId,
    artifactId: row.artifactId,
    sceneId: row.sceneId,
    answers: row.answers,
    results: row.results,
    score: row.score,
    maxScore: row.maxScore,
    revision: row.revision,
    submittedAt: row.submittedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
