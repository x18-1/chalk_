import { apiJson } from './client';

export type QuizQuestionResult = {
  questionId: string;
  correct: boolean | null;
  awardedPoints: number | null;
  maxPoints: number | null;
};

export type QuizAttempt = {
  id: string;
  learningSessionId: string;
  classroomId: string;
  artifactId: string;
  sceneId: string;
  answers: Record<string, string[]>;
  results: QuizQuestionResult[];
  score: number;
  maxScore: number;
  revision: number;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
};

export const quizAttemptsApi = {
  list(learningSessionId: string, signal?: AbortSignal) {
    return apiJson<{ quizAttempts: QuizAttempt[] }>(
      `/learning-sessions/${encodeURIComponent(learningSessionId)}/quiz-attempts`,
      { signal },
    );
  },
  save(
    learningSessionId: string,
    sceneId: string,
    expectedRevision: number,
    answers: Record<string, string[]>,
  ) {
    return apiJson<{ quizAttempt: QuizAttempt }>(
      `/learning-sessions/${encodeURIComponent(learningSessionId)}/quiz-attempts/${encodeURIComponent(sceneId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ expectedRevision, answers }),
      },
    );
  },
};
