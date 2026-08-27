import {
  createChalkboardRuntime,
  CursorSnapshotSchema,
  type RuntimeSnapshot,
} from '@chalk/chalkboard';

import type { Database } from '../../../db/client';
import { createLearningSessionsDal } from '../../../db/dal';
import { ApiError } from '../../../http/errors';

export class LearningSessionService {
  private readonly sessions;

  constructor(db: Database) {
    this.sessions = createLearningSessionsDal(db);
  }

  async createOrResume(userId: string, classroomId: string, artifactId: string) {
    const result = await this.sessions.createOrResume(userId, {
      classroomId,
      artifactId,
      initialCursor(document) {
        return createChalkboardRuntime(document).getSnapshot();
      },
    });
    return { learningSession: projectLearningSession(result.row), created: result.created };
  }

  async get(userId: string, sessionId: string) {
    const result = await this.sessions.get(userId, sessionId);
    return { learningSession: projectLearningSession(result.session) };
  }

  async saveCursor(userId: string, sessionId: string, input: {
    expectedRevision: number;
    cursor: RuntimeSnapshot;
  }) {
    const current = await this.sessions.get(userId, sessionId);
    if (current.document === null || !isCursorValidForArtifact(input.cursor, current.document)) {
      throw new ApiError(
        422,
        'Playback cursor does not belong to this classroom artifact',
        'PLAYBACK_CURSOR_INVALID',
      );
    }
    const saved = await this.sessions.saveCursor(userId, {
      sessionId,
      expectedRevision: input.expectedRevision,
      cursor: input.cursor,
    });
    if (!saved) {
      throw new ApiError(
        409,
        'Playback cursor has a newer saved revision',
        'PLAYBACK_CURSOR_CONFLICT',
      );
    }
    return { learningSession: projectLearningSession(saved) };
  }
}

function isCursorValidForArtifact(cursor: RuntimeSnapshot, document: unknown) {
  const parsed = CursorSnapshotSchema.safeParse(cursor);
  if (!parsed.success) return false;
  if (cursor.completed !== (cursor.mode === 'completed')) return false;
  const runtime = createChalkboardRuntime(document);
  const restored = runtime.restore(parsed.data);
  if (!restored.ok) return false;
  const normalized = runtime.getSnapshot();
  return normalized.stageId === cursor.stageId
    && normalized.sceneId === cursor.sceneId
    && normalized.sceneIndex === cursor.sceneIndex
    && normalized.actionIndex === cursor.actionIndex
    && normalized.mode === cursor.mode
    && normalized.completed === cursor.completed;
}

function projectLearningSession(row: typeof import('../../../db/schema').classroomLearningSessions.$inferSelect) {
  return {
    id: row.id,
    classroomId: row.classroomId,
    artifactId: row.artifactId,
    cursor: {
      version: row.cursorVersion as 1,
      stageId: row.stageId,
      sceneId: row.sceneId,
      sceneIndex: row.sceneIndex,
      actionIndex: row.actionIndex,
      mode: row.mode as 'idle' | 'playing' | 'paused' | 'completed',
      completed: row.completed,
    },
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
