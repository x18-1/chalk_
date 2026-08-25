import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadCursorSnapshot, saveCursorSnapshot, type CursorSnapshotStore } from '../../src/cursor.js';
import { createChalkboardRuntime } from '../../src/runtime.js';
import { parseStageDocument, StageSchema } from '../../src/schema.js';

const liveClassroom = JSON.parse(
  readFileSync(new URL('../fixtures/openmaic-live-classroom.json', import.meta.url), 'utf8'),
) as unknown;

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

describe('live OpenMAIC classroom compatibility', () => {
  it('validates the complete real Stage -> Scene -> Action response', () => {
    const result = StageSchema.safeParse(liveClassroom);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.stage.id).toBe('4DuyVUkWv3');
    expect(result.data.scenes).toHaveLength(5);
    expect(result.data.scenes.map((scene) => scene.type)).toEqual([
      'slide',
      'slide',
      'slide',
      'interactive',
      'quiz',
    ]);
    expect(result.data.scenes.flatMap((scene) => scene.actions ?? [])).toHaveLength(43);
    expect(result.data.scenes[3]?.content).toMatchObject({
      type: 'interactive',
      html: expect.any(String),
      widgetType: 'simulation',
    });
    expect(result.data.scenes[4]?.content).toMatchObject({
      type: 'quiz',
      questions: expect.arrayContaining([expect.objectContaining({ id: 'q1' })]),
    });
  });

  it('loads and navigates every action in the real classroom', () => {
    const document = parseStageDocument(liveClassroom);
    const runtime = createChalkboardRuntime(document);

    expect(runtime.start()).toEqual({ ok: true });
    expect(runtime.getState()).toMatchObject({
      sceneId: 'scene_1shvI_Q8Jr',
      sceneIndex: 0,
      actionIndex: 0,
      mode: 'playing',
    });

    let transitions = 0;
    while (!runtime.getState().completed) {
      expect(runtime.next()).toEqual({ ok: true });
      transitions += 1;
      expect(transitions).toBeLessThan(50);
    }

    expect(transitions).toBe(43);
    expect(runtime.getState()).toMatchObject({
      sceneId: 'scene_Hfvr4nop2V',
      sceneIndex: 4,
      actionIndex: 2,
      mode: 'completed',
    });
  });

  it('persists and restores the same live scene/action cursor after refresh', async () => {
    const document = parseStageDocument(liveClassroom);
    const store = new MemoryCursorStore();
    const beforeRefresh = createChalkboardRuntime(document);
    beforeRefresh.start();
    expect(beforeRefresh.jump('scene_o1z3O35bg1', 4)).toEqual({ ok: true });
    expect(beforeRefresh.pause()).toEqual({ ok: true });
    await saveCursorSnapshot(beforeRefresh.getSnapshot(), store);

    const afterRefresh = createChalkboardRuntime(document);
    const snapshot = await loadCursorSnapshot(document.stage.id, store);
    expect(snapshot).not.toBeNull();
    expect(afterRefresh.restore(snapshot!)).toEqual({ ok: true });
    expect(afterRefresh.getState()).toMatchObject({
      mode: 'paused',
      sceneId: 'scene_o1z3O35bg1',
      sceneIndex: 3,
      actionIndex: 4,
      completed: false,
    });
  });
});
