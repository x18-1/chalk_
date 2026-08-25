import { describe, expect, it } from 'vitest';
import { openMaicStageFixture } from '../fixtures/openmaic-stage.js';
import { createChalkboardRuntime } from '../../src/runtime.js';

describe('Chalkboard runtime loading and navigation', () => {
  it('navigates authored pages independently from action cursors', () => {
    const runtime = createChalkboardRuntime(openMaicStageFixture);
    const firstScene = runtime.getState().sceneId;

    expect(runtime.nextScene()).toEqual({ ok: true });
    expect(runtime.getState()).toMatchObject({ sceneIndex: 1, actionIndex: 0 });
    expect(runtime.getState().sceneId).not.toBe(firstScene);

    expect(runtime.previousScene()).toEqual({ ok: true });
    expect(runtime.getState()).toMatchObject({ sceneIndex: 0, actionIndex: 0 });
  });
  it('loads an OpenMAIC Stage and navigates actions and scenes', () => {
    const runtime = createChalkboardRuntime(openMaicStageFixture);

    expect(runtime.getState()).toMatchObject({
      mode: 'idle',
      sceneId: 'scene-balance',
      sceneIndex: 0,
      actionIndex: 0,
      completed: false,
    });

    expect(runtime.start()).toEqual({ ok: true });
    expect(runtime.getState().mode).toBe('playing');
    expect(runtime.next()).toEqual({ ok: true });
    expect(runtime.getState()).toMatchObject({ sceneId: 'scene-balance', actionIndex: 1 });
    expect(runtime.next()).toEqual({ ok: true });
    expect(runtime.getState()).toMatchObject({ sceneId: 'scene-operation', sceneIndex: 1, actionIndex: 0 });

    expect(runtime.pause()).toEqual({ ok: true });
    expect(runtime.getState().mode).toBe('paused');
    expect(runtime.resume()).toEqual({ ok: true });
    expect(runtime.getState().mode).toBe('playing');
  });

  it('jumps to a scene/action, goes backwards, and restarts deterministically', () => {
    const runtime = createChalkboardRuntime(openMaicStageFixture);
    runtime.start();

    expect(runtime.jump('scene-check', 0)).toEqual({ ok: true });
    expect(runtime.getState()).toMatchObject({ sceneId: 'scene-check', sceneIndex: 2, actionIndex: 0 });
    expect(runtime.previous()).toEqual({ ok: true });
    expect(runtime.getState()).toMatchObject({ sceneId: 'scene-operation', sceneIndex: 1, actionIndex: 0 });
    expect(runtime.restart()).toEqual({ ok: true });
    expect(runtime.getState()).toMatchObject({ mode: 'idle', sceneId: 'scene-balance', sceneIndex: 0, actionIndex: 0 });
  });

  it('returns an explicit unsupported error for PBL instead of rendering an empty scene', () => {
    const runtime = createChalkboardRuntime(openMaicStageFixture);

    expect(runtime.jump('scene-pbl', 0)).toEqual({
      ok: false,
      error: { code: 'UNSUPPORTED_SCENE_TYPE', sceneId: 'scene-pbl', sceneType: 'pbl' },
    });
    expect(runtime.getState().sceneId).toBe('scene-balance');
  });
});
