"use client";

import {
  adaptOpenMaicClassroomResponse,
  clearCursorSnapshot,
  loadCursorSnapshot,
  type AdaptedClassroom,
  type CursorSnapshotStore,
  type RuntimeSnapshot,
} from "@chalk/chalkboard";
import {
  ApiRequestError,
  classroomsApi,
  learningSessionsApi,
  quizAttemptsApi,
  type ClassroomSummary,
  type LearningSession,
  type QuizAttempt,
  type QuizQuestionResult,
} from "../../../api";

function cursorStore(stageId: string): CursorSnapshotStore {
  const key = `chalkboard:cursor:${stageId}`;
  const legacyKey = stageId === "681PbzeDfm" ? "chalkboard:cursor:fourier-transform-intro" : null;
  return {
    async load() {
      const value = window.localStorage.getItem(key) ?? (legacyKey ? window.localStorage.getItem(legacyKey) : null);
      if (!value) return null;
      try {
        return JSON.parse(value);
      } catch {
        window.localStorage.removeItem(key);
        return null;
      }
    },
    async save(_id, snapshot) {
      window.localStorage.setItem(key, JSON.stringify(snapshot));
      if (legacyKey) window.localStorage.removeItem(legacyKey);
    },
    async clear() {
      window.localStorage.removeItem(key);
      if (legacyKey) window.localStorage.removeItem(legacyKey);
    },
  };
}

export type LoadedClassroomSession = {
  classroom: AdaptedClassroom;
  learningSession: ClassroomSession;
};

export type CursorSaveResult =
  | { status: "saved"; learningSession?: LearningSession }
  | { status: "conflict"; learningSession: LearningSession };

export type ClassroomQuizAttempt = Pick<QuizAttempt, "answers" | "results" | "score" | "maxScore">;

export type QuizAttemptSaveResult =
  | { status: "saved"; quizAttempt: ClassroomQuizAttempt }
  | { status: "conflict"; quizAttempt: ClassroomQuizAttempt };

export interface ClassroomSession {
  discussionTarget(): { kind: "learning_session" | "generation_run"; id: string };
  quizAttempt(sceneId: string): ClassroomQuizAttempt | null;
  saveQuizAttempt(sceneId: string, answers: Record<string, string[]>): Promise<QuizAttemptSaveResult>;
  save(cursor: RuntimeSnapshot): Promise<CursorSaveResult>;
}

export class ServerClassroomSession implements ClassroomSession {
  private current: LearningSession;
  private readonly quizAttempts = new Map<string, QuizAttempt>();
  private saveQueue: Promise<void> = Promise.resolve();
  private conflictEpoch = 0;
  private readonly quizSaveQueues = new Map<string, Promise<void>>();

  constructor(session: LearningSession, quizAttempts: QuizAttempt[]) {
    this.current = session;
    for (const attempt of quizAttempts) this.quizAttempts.set(attempt.sceneId, attempt);
  }

  get snapshot() {
    return this.current;
  }

  discussionTarget() {
    return { kind: "learning_session" as const, id: this.current.id };
  }

  quizAttempt(sceneId: string) {
    return this.quizAttempts.get(sceneId) ?? null;
  }

  saveQuizAttempt(
    sceneId: string,
    answers: Record<string, string[]>,
  ): Promise<QuizAttemptSaveResult> {
    const previous = this.quizSaveQueues.get(sceneId) ?? Promise.resolve();
    const operation = previous.then(() => this.saveQuizAttemptNow(sceneId, answers));
    this.quizSaveQueues.set(sceneId, operation.then(() => undefined, () => undefined));
    return operation;
  }

  save(cursor: RuntimeSnapshot): Promise<CursorSaveResult> {
    const queuedEpoch = this.conflictEpoch;
    const operation = this.saveQueue.then(() => queuedEpoch === this.conflictEpoch
      ? this.saveNow(cursor)
      : { status: "conflict" as const, learningSession: this.current });
    this.saveQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async saveNow(cursor: RuntimeSnapshot): Promise<CursorSaveResult> {
    try {
      const result = await learningSessionsApi.saveCursor(
        this.current.id,
        this.current.revision,
        cursor,
      );
      this.current = result.learningSession;
      return { status: "saved", learningSession: this.current };
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.code !== "PLAYBACK_CURSOR_CONFLICT") throw error;
      const result = await learningSessionsApi.get(this.current.id);
      this.current = result.learningSession;
      this.conflictEpoch += 1;
      return { status: "conflict", learningSession: this.current };
    }
  }

  private async saveQuizAttemptNow(
    sceneId: string,
    answers: Record<string, string[]>,
  ): Promise<QuizAttemptSaveResult> {
    const current = this.quizAttempts.get(sceneId);
    try {
      const result = await quizAttemptsApi.save(
        this.current.id,
        sceneId,
        current?.revision ?? 0,
        answers,
      );
      this.quizAttempts.set(sceneId, result.quizAttempt);
      return { status: "saved", quizAttempt: result.quizAttempt };
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.code !== "QUIZ_ATTEMPT_CONFLICT") throw error;
      const restored = await quizAttemptsApi.list(this.current.id);
      for (const attempt of restored.quizAttempts) this.quizAttempts.set(attempt.sceneId, attempt);
      const quizAttempt = this.quizAttempts.get(sceneId);
      if (!quizAttempt) throw error;
      return { status: "conflict", quizAttempt };
    }
  }
}

/**
 * Draft playback remains deliberately separate from a formal Learning Session.
 * These snapshots make an owner able to refresh the same browser while the
 * mutable draft grows, without inventing an Artifact or sending draft progress
 * to the immutable-session API.
 */
export class DraftClassroomSession implements ClassroomSession {
  private readonly attempts = new Map<string, ClassroomQuizAttempt>();

  constructor(
    private readonly draftId: string,
    private readonly generationRunId: string,
    private readonly document: AdaptedClassroom["document"],
  ) {
    try {
      const stored = window.localStorage.getItem(this.quizKey());
      const attempts = stored ? JSON.parse(stored) as Record<string, ClassroomQuizAttempt> : {};
      for (const [sceneId, attempt] of Object.entries(attempts)) this.attempts.set(sceneId, attempt);
    } catch {
      window.localStorage.removeItem(this.quizKey());
    }
  }

  discussionTarget() {
    return { kind: "generation_run" as const, id: this.generationRunId };
  }

  restoreCursor(classroom: AdaptedClassroom) {
    try {
      const stored = window.localStorage.getItem(this.cursorKey());
      if (!stored) return;
      const snapshot = JSON.parse(stored) as RuntimeSnapshot;
      if (!classroom.document.scenes.some((scene) => scene.id === snapshot.sceneId)) return;
      const restored = classroom.runtime.restore(normalizeGrowingDraftSnapshot(snapshot, classroom));
      if (!restored.ok) window.localStorage.removeItem(this.cursorKey());
    } catch {
      window.localStorage.removeItem(this.cursorKey());
    }
  }

  quizAttempt(sceneId: string) {
    return this.attempts.get(sceneId) ?? null;
  }

  async saveQuizAttempt(sceneId: string, answers: Record<string, string[]>): Promise<QuizAttemptSaveResult> {
    const scene = this.document.scenes.find((candidate) => candidate.id === sceneId);
    const questions = scene?.type === "quiz" && Array.isArray(scene.content.questions)
      ? scene.content.questions as Array<{ id?: unknown; answer?: unknown; points?: unknown }>
      : [];
    const results: QuizQuestionResult[] = questions.map((question, index) => {
      const questionId = typeof question.id === "string" ? question.id : `question-${index + 1}`;
      const expected = Array.isArray(question.answer) && question.answer.every((value) => typeof value === "string")
        ? [...question.answer].sort()
        : null;
      const actual = [...(answers[questionId] ?? [])].sort();
      const maxPoints = typeof question.points === "number" && Number.isFinite(question.points) ? question.points : 1;
      const correct = expected ? expected.length === actual.length && expected.every((value, answerIndex) => value === actual[answerIndex]) : null;
      return { questionId, correct, awardedPoints: correct === null ? null : correct ? maxPoints : 0, maxPoints: correct === null ? null : maxPoints };
    });
    const maxScore = results.reduce((total, result) => total + (result.maxPoints ?? 0), 0);
    const attempt: ClassroomQuizAttempt = {
      answers,
      results,
      score: results.reduce((total, result) => total + (result.awardedPoints ?? 0), 0),
      maxScore,
    };
    this.attempts.set(sceneId, attempt);
    window.localStorage.setItem(this.quizKey(), JSON.stringify(Object.fromEntries(this.attempts)));
    return { status: "saved", quizAttempt: attempt };
  }

  async save(cursor: RuntimeSnapshot): Promise<CursorSaveResult> {
    window.localStorage.setItem(this.cursorKey(), JSON.stringify(cursor));
    return { status: "saved" };
  }

  private cursorKey() {
    return `chalkboard:draft-cursor:${this.draftId}`;
  }

  private quizKey() {
    return `chalkboard:draft-quizzes:${this.draftId}`;
  }
}

export function restoreGrowingDraftCursor(
  previous: AdaptedClassroom,
  next: AdaptedClassroom,
) {
  const snapshot = previous.runtime.getSnapshot();
  if (!next.document.scenes.some((scene) => scene.id === snapshot.sceneId)) return;
  next.runtime.restore(normalizeGrowingDraftSnapshot(snapshot, next));
}

function normalizeGrowingDraftSnapshot(snapshot: RuntimeSnapshot, classroom: AdaptedClassroom): RuntimeSnapshot {
  const sceneIndex = classroom.document.scenes.findIndex((scene) => scene.id === snapshot.sceneId);
  const isLastAvailableScene = sceneIndex === classroom.document.scenes.length - 1;
  if (!snapshot.completed || isLastAvailableScene) return snapshot;
  return { ...snapshot, mode: "paused", completed: false };
}

export async function loadClassroomSession(
  selected: ClassroomSummary,
  signal: AbortSignal,
): Promise<LoadedClassroomSession> {
  if (!selected.latestArtifact) {
    throw new ApiRequestError(409, "这门课堂仍在生成中。", "CLASSROOM_GENERATION_ACTIVE");
  }
  const [artifact, sessionResult] = await Promise.all([
    classroomsApi.artifact(selected.id, selected.latestArtifact.id, signal),
    learningSessionsApi.createOrResume(selected.id, selected.latestArtifact.id, signal),
  ]);
  const classroom = adaptOpenMaicClassroomResponse({ success: true, classroom: artifact.document });
  let learningSession = sessionResult.learningSession;
  const store = cursorStore(classroom.document.stage.id);
  const legacySnapshot = await loadCursorSnapshot(classroom.document.stage.id, store);
  const initialCursor = classroom.runtime.getSnapshot();

  if (legacySnapshot && learningSession.revision === 1 && cursorsEqual(learningSession.cursor, initialCursor)) {
    const restored = classroom.runtime.restore(legacySnapshot);
    if (restored.ok) {
      try {
        const migrated = await learningSessionsApi.saveCursor(
          learningSession.id,
          learningSession.revision,
          legacySnapshot,
        );
        learningSession = migrated.learningSession;
        await clearCursorSnapshot(classroom.document.stage.id, store);
      } catch (error) {
        if (!(error instanceof ApiRequestError) || error.code !== "PLAYBACK_CURSOR_CONFLICT") throw error;
        learningSession = (await learningSessionsApi.get(learningSession.id, signal)).learningSession;
        await clearCursorSnapshot(classroom.document.stage.id, store);
      }
    } else {
      await clearCursorSnapshot(classroom.document.stage.id, store);
    }
  } else if (legacySnapshot) {
    await clearCursorSnapshot(classroom.document.stage.id, store);
  }

  const restored = classroom.runtime.restore(learningSession.cursor);
  if (!restored.ok) {
    throw new ApiRequestError(
      409,
      "已保存的课堂进度无法恢复，请稍后重试。",
      "PLAYBACK_CURSOR_RESTORE_FAILED",
    );
  }
  const { quizAttempts } = await quizAttemptsApi.list(learningSession.id, signal);
  return {
    classroom,
    learningSession: new ServerClassroomSession(learningSession, quizAttempts),
  };
}

export function saveClassroomCursor(
  classroom: AdaptedClassroom,
  learningSession: ClassroomSession,
): Promise<CursorSaveResult> {
  return learningSession.save(classroom.runtime.getSnapshot());
}

function cursorsEqual(left: RuntimeSnapshot, right: RuntimeSnapshot) {
  return left.version === right.version
    && left.stageId === right.stageId
    && left.sceneId === right.sceneId
    && left.sceneIndex === right.sceneIndex
    && left.actionIndex === right.actionIndex
    && left.mode === right.mode
    && left.completed === right.completed;
}
