import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  adaptOpenMaicClassroomResponse,
  executeAction,
  type ActionExecutor,
} from '../../src/adapter.js';

const liveResponse = JSON.parse(
  JSON.stringify({
    success: true,
    classroom: JSON.parse(
      readFileSync(new URL('../fixtures/openmaic-live-classroom.json', import.meta.url), 'utf8'),
    ),
  }),
) as unknown;

describe('OpenMAIC -> Chalkboard adapter', () => {
  it('unwraps and validates the classroom response into playable scene views', () => {
    const adapted = adaptOpenMaicClassroomResponse(liveResponse);

    expect(adapted.document.stage.id).toBe('4DuyVUkWv3');
    expect(adapted.scenes).toHaveLength(5);
    expect(adapted.scenes.map((scene) => scene.type)).toEqual([
      'slide',
      'slide',
      'slide',
      'interactive',
      'quiz',
    ]);
    expect(adapted.scenes[0]).toMatchObject({
      id: 'scene_1shvI_Q8Jr',
      title: '天平与等式',
      type: 'slide',
      actionCount: 9,
    });
    expect(adapted.scenes[3]).toMatchObject({
      type: 'interactive',
      content: { html: expect.any(String), widgetType: 'simulation' },
    });
    expect(adapted.runtime.getState()).toMatchObject({
      stageId: '4DuyVUkWv3',
      sceneId: 'scene_1shvI_Q8Jr',
      actionIndex: 0,
    });
    expect(adapted.participants).toEqual([
      { id: 'default-1', name: 'default-1', role: 'agent' },
      { id: 'default-2', name: 'default-2', role: 'agent' },
      { id: 'default-3', name: 'default-3', role: 'agent' },
      { id: 'default-4', name: 'default-4', role: 'agent' },
      { id: 'default-5', name: 'default-5', role: 'agent' },
      { id: 'default-6', name: 'default-6', role: 'agent' },
    ]);
  });

  it('rejects an unsuccessful or malformed API envelope', () => {
    expect(() => adaptOpenMaicClassroomResponse({ success: false })).toThrow();
    expect(() => adaptOpenMaicClassroomResponse({ success: true, classroom: {} })).toThrow();
  });

  it('maps authored actions to injected browser capabilities', async () => {
    const calls: string[] = [];
    const executor: ActionExecutor = {
      speak: async (text) => calls.push(`speak:${text}`),
      spotlight: async (elementId) => calls.push(`spotlight:${elementId}`),
      discussion: async ({ topic }) => calls.push(`discussion:${topic}`),
      widgetHighlight: async ({ target }) => calls.push(`widget:${target}`),
    };
    const scene = adaptOpenMaicClassroomResponse(liveResponse).document.scenes[0]!;

    await expect(executeAction(scene.actions![0]!, executor)).resolves.toMatchObject({
      ok: true,
      effect: { kind: 'spotlight', elementId: 'text_Xi7jGXJr' },
    });
    await expect(executeAction(scene.actions![1]!, executor)).resolves.toMatchObject({
      ok: true,
      effect: { kind: 'speech' },
    });
    await expect(executeAction(scene.actions![8]!, executor)).resolves.toMatchObject({
      ok: true,
      effect: { kind: 'discussion' },
    });
    expect(calls).toEqual([
      'spotlight:text_Xi7jGXJr',
      'speak:同学们好，欢迎来到今天的数学课堂！今天我们要借助天平来理解等式。先看标题——天平与等式。',
      'discussion:如果天平两边同时增加相同重量的物体，天平还会平衡吗？为什么？',
    ]);
  });

  it('returns an explicit result when a valid action has no browser capability', async () => {
    const adapted = adaptOpenMaicClassroomResponse(liveResponse);
    const action = adapted.document.scenes[0]!.actions![0]!;
    const executor: ActionExecutor = {
      speak: () => undefined,
      spotlight: () => undefined,
      discussion: () => undefined,
      widgetHighlight: () => undefined,
    };

    await expect(executeAction({ ...action, type: 'laser' }, executor)).resolves.toEqual({
      ok: false,
      error: { code: 'UNSUPPORTED_ACTION', actionType: 'laser' },
    });
  });

  it('maps all OpenMAIC widget messages without collapsing their payloads', async () => {
    const calls: string[] = [];
    const executor: ActionExecutor = {
      speak: () => undefined,
      spotlight: () => undefined,
      discussion: () => undefined,
      widgetHighlight: ({ target }) => calls.push(`highlight:${target}`),
      widgetSetState: ({ state }) => calls.push(`state:${String(state.harmonicCount)}`),
      widgetAnnotation: ({ target, content }) => calls.push(`annotation:${target}:${content}`),
      widgetReveal: ({ target }) => calls.push(`reveal:${target}`),
    };

    await executeAction({ id: 'highlight', type: 'widget_highlight', target: '#slider' }, executor);
    await executeAction({ id: 'state', type: 'widget_setState', state: { harmonicCount: 10 } }, executor);
    await executeAction({ id: 'annotation', type: 'widget_annotation', target: '#canvas', content: '看这里' }, executor);
    await executeAction({ id: 'reveal', type: 'widget_reveal', target: '#answer' }, executor);

    expect(calls).toEqual([
      'highlight:#slider',
      'state:10',
      'annotation:#canvas:看这里',
      'reveal:#answer',
    ]);
  });
});
