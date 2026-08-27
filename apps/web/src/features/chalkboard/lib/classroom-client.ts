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
  learningSession: ServerClassroomSession;
  selected: ClassroomSummary;
  classrooms: ClassroomSummary[];
};

export type CursorSaveResult =
  | { status: "saved"; learningSession: LearningSession }
  | { status: "conflict"; learningSession: LearningSession };

export type QuizAttemptSaveResult =
  | { status: "saved"; quizAttempt: QuizAttempt }
  | { status: "conflict"; quizAttempt: QuizAttempt };

export class ServerClassroomSession {
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

export async function loadClassroomSession(
  requestedClassroomId: string | null,
  signal: AbortSignal,
): Promise<LoadedClassroomSession> {
  const { classrooms } = await classroomsApi.list(signal);
  if (classrooms.length === 0) throw new ApiRequestError(404, "还没有可学习的课堂。", "CLASSROOMS_EMPTY");
  const selected = requestedClassroomId
    ? classrooms.find((classroom) => classroom.id === requestedClassroomId)
    : classrooms[0];
  if (!selected) throw new ApiRequestError(404, "没有找到这门课堂，它可能已被移除。", "CLASSROOM_NOT_FOUND");
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
    selected,
    classrooms,
  };
}

export function saveClassroomCursor(
  classroom: AdaptedClassroom,
  learningSession: ServerClassroomSession,
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
