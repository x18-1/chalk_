import { describe, expect, it } from 'vitest';
import { openMaicStageFixture } from '../fixtures/openmaic-stage.js';
import { createChalkboardRuntime } from '../../src/runtime.js';
import {
  clearCursorSnapshot,
  loadCursorSnapshot,
  saveCursorSnapshot,
  type CursorSnapshotStore,
} from '../../src/cursor.js';

class MemoryCursorStore implements CursorSnapshotStore {
  readonly values = new Map<string, unknown>();

  async load(stageId: string): Promise<unknown> {
    return this.values.get(stageId) ?? null;
  }

  async save(stageId: string, snapshot: unknown): Promise<void> {
    this.values.set(stageId, structuredClone(snapshot));
  }

  async clear(stageId: string): Promise<void> {
    this.values.delete(stageId);
  }
}

describe('cursor snapshot persistence', () => {
  it('saves and loads the scene/action cursor without losing playback mode', async () => {
    const runtime = createChalkboardRuntime(openMaicStageFixture);
    runtime.start();
    runtime.jump('scene-operation', 0);
    runtime.pause();
    const store = new MemoryCursorStore();

    await saveCursorSnapshot(runtime.getSnapshot(), store);
    await expect(loadCursorSnapshot(openMaicStageFixture.stage.id, store)).resolves.toMatchObject({
      stageId: openMaicStageFixture.stage.id,
      sceneId: 'scene-operation',
      actionIndex: 0,
      mode: 'paused',
    });
  });

  it('treats malformed or cleared snapshots as absent', async () => {
    const store = new MemoryCursorStore();
    store.values.set(openMaicStageFixture.stage.id, { sceneId: 'scene-operation', actionIndex: 'bad' });

    await expect(loadCursorSnapshot(openMaicStageFixture.stage.id, store)).resolves.toBeNull();
    await saveCursorSnapshot(
      {
        version: 1,
        stageId: openMaicStageFixture.stage.id,
        sceneId: 'scene-operation',
        sceneIndex: 1,
        actionIndex: 0,
        mode: 'paused',
        completed: false,
      },
      store,
    );
    await clearCursorSnapshot(openMaicStageFixture.stage.id, store);
    await expect(loadCursorSnapshot(openMaicStageFixture.stage.id, store)).resolves.toBeNull();
  });
});
