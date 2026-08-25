import { z } from 'zod';
import type { RuntimeSnapshot } from './runtime';

export interface CursorSnapshotStore {
  load(stageId: string): Promise<unknown>;
  save(stageId: string, snapshot: RuntimeSnapshot): Promise<void>;
  clear(stageId: string): Promise<void>;
}

export const CursorSnapshotSchema = z.object({
  version: z.literal(1),
  stageId: z.string().min(1),
  sceneId: z.string().min(1).nullable(),
  sceneIndex: z.number().int().nonnegative(),
  actionIndex: z.number().int().nonnegative(),
  mode: z.enum(['idle', 'playing', 'paused', 'completed']),
  completed: z.boolean(),
});

export async function saveCursorSnapshot(
  snapshot: RuntimeSnapshot,
  store: CursorSnapshotStore,
): Promise<void> {
  CursorSnapshotSchema.parse(snapshot);
  await store.save(snapshot.stageId, snapshot);
}

export async function loadCursorSnapshot(
  stageId: string,
  store: CursorSnapshotStore,
): Promise<RuntimeSnapshot | null> {
  const value = await store.load(stageId);
  const result = CursorSnapshotSchema.safeParse(value);
  if (!result.success || result.data.stageId !== stageId) return null;
  return result.data;
}

export function clearCursorSnapshot(stageId: string, store: CursorSnapshotStore): Promise<void> {
  return store.clear(stageId);
}

// Familiar aliases for callers that treat the snapshot as the playback cursor.
export const saveCursor = saveCursorSnapshot;
export const loadCursor = loadCursorSnapshot;
export const clearCursor = clearCursorSnapshot;
