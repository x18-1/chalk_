import { describe, expect, it } from 'vitest';
import { openMaicStageFixture } from '../fixtures/openmaic-stage.js';
import { loadCursorSnapshot, saveCursorSnapshot, type CursorSnapshotStore } from '../../src/cursor.js';
import { createChalkboardRuntime } from '../../src/runtime.js';

class MemoryCursorStore implements CursorSnapshotStore {
  private readonly values = new Map<string, unknown>();

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

describe('runtime refresh recovery', () => {
  it('restores the same scene/action after constructing a fresh runtime', async () => {
    const store = new MemoryCursorStore();
    const beforeRefresh = createChalkboardRuntime(openMaicStageFixture);
    beforeRefresh.start();
    beforeRefresh.jump('scene-operation', 0);
    beforeRefresh.pause();
    await saveCursorSnapshot(beforeRefresh.getSnapshot(), store);

    const afterRefresh = createChalkboardRuntime(openMaicStageFixture);
    const snapshot = await loadCursorSnapshot(openMaicStageFixture.stage.id, store);
    expect(snapshot).not.toBeNull();
    expect(afterRefresh.restore(snapshot!)).toEqual({ ok: true });
    expect(afterRefresh.getState()).toMatchObject({
      mode: 'paused',
      sceneId: 'scene-operation',
      sceneIndex: 1,
      actionIndex: 0,
      completed: false,
    });
  });

  it('does not restore a snapshot belonging to another Stage', () => {
    const runtime = createChalkboardRuntime(openMaicStageFixture);
    expect(
      runtime.restore({
        version: 1,
        stageId: 'other-stage',
        sceneId: 'scene-operation',
        sceneIndex: 1,
        actionIndex: 0,
        mode: 'paused',
        completed: false,
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_SNAPSHOT' } });
    expect(runtime.getState().sceneId).toBe('scene-balance');
  });
});
