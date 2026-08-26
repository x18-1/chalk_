import { describe, expect, it, vi } from 'vitest';
import { openMaicStageFixture } from '../fixtures/openmaic-stage.js';
import { createChalkboardRuntime } from '../../src/runtime.js';
import { ChalkboardPlaybackController, type PlaybackExecutor } from '../../src/playback.js';

function makeExecutor(overrides: Partial<PlaybackExecutor> = {}): PlaybackExecutor {
  return {
    speak: vi.fn(async () => undefined),
    spotlight: vi.fn(),
    discussion: vi.fn(),
    widgetHighlight: vi.fn(),
    ...overrides,
  };
}

describe('Chalkboard playback controller', () => {
  it('continues a restored playing snapshot when a controller is attached', async () => {
    const runtime = createChalkboardRuntime(openMaicStageFixture);
    expect(runtime.restore({
      version: 1,
      stageId: 'stage-equation-properties-v1',
      sceneId: 'scene-balance',
      sceneIndex: 0,
      actionIndex: 0,
      mode: 'playing',
      completed: false,
    })).toEqual({ ok: true });

    const controller = new ChalkboardPlaybackController({ runtime, executor: makeExecutor() });
    try {
      await controller.activate();
      await vi.waitFor(() => expect(runtime.getState().mode).toBe('idle'));
      expect(runtime.getState()).toMatchObject({
        sceneId: 'scene-balance',
        actionIndex: 2,
        completed: false,
      });
    } finally {
      await controller.dispose();
    }
  });

  it('exposes scene navigation separately from action navigation', async () => {
    const runtime = createChalkboardRuntime(openMaicStageFixture);
    const controller = new ChalkboardPlaybackController({ runtime, executor: makeExecutor() });

    await expect(controller.nextScene()).resolves.toEqual({ ok: true });
    expect(runtime.getState()).toMatchObject({ sceneIndex: 1, actionIndex: 0 });
    await expect(controller.previousScene()).resolves.toEqual({ ok: true });
    expect(runtime.getState()).toMatchObject({ sceneIndex: 0, actionIndex: 0 });
    await controller.dispose();
  });

  it('selects a scene without executing its first action', async () => {
    const runtime = createChalkboardRuntime(openMaicStageFixture);
    const executor = makeExecutor();
    const controller = new ChalkboardPlaybackController({ runtime, executor });

    await expect(controller.selectScene('scene-operation')).resolves.toEqual({ ok: true });
    expect(runtime.getState()).toMatchObject({ sceneId: 'scene-operation', actionIndex: 0 });
    expect(executor.spotlight).not.toHaveBeenCalled();
    await controller.dispose();
  });

  it('finishes the current scene without crossing into the next scene when auto-play is off', async () => {
    const runtime = createChalkboardRuntime(openMaicStageFixture);
    const controller = new ChalkboardPlaybackController({ runtime, executor: makeExecutor() });

    await controller.start();
    await vi.waitFor(() => expect(runtime.getState().mode).toBe('idle'));

    expect(runtime.getState()).toMatchObject({
      sceneId: 'scene-balance',
      sceneIndex: 0,
      actionIndex: 2,
      completed: false,
    });
    await controller.dispose();
  });

  it('auto-play advances a completed slide and stops after the interactive scene', async () => {
    const runtime = createChalkboardRuntime(openMaicStageFixture);
    const controller = new ChalkboardPlaybackController({
      runtime,
      executor: makeExecutor(),
      isAutoPlayEnabled: () => true,
    });

    await controller.start();
    await vi.waitFor(() => expect(runtime.getState().mode).toBe('idle'));

    expect(runtime.getState()).toMatchObject({
      sceneId: 'scene-operation',
      sceneIndex: 1,
      actionIndex: 1,
      completed: false,
    });
    expect(controller.getState().actionStatus).toBe('idle');
    await controller.dispose();
  });

  it('pauses and resumes a blocking action without advancing its cursor', async () => {
    let resolveSpeech: (() => void) | undefined;
    const speechStarted = vi.fn();
    const executor = makeExecutor({
      speak: vi.fn(() => {
        speechStarted();
        return new Promise<void>((resolve) => { resolveSpeech = resolve; });
      }),
      pause: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
    });
    const runtime = createChalkboardRuntime(openMaicStageFixture);
    const controller = new ChalkboardPlaybackController({ runtime, executor });

    await controller.start();
    await vi.waitFor(() => expect(speechStarted).toHaveBeenCalled());
    const cursorBeforePause = runtime.getState().actionIndex;
    await controller.pause();
    expect(runtime.getState()).toMatchObject({ mode: 'paused', actionIndex: cursorBeforePause });
    expect(executor.pause).toHaveBeenCalledOnce();

    await controller.resume();
    expect(executor.resume).toHaveBeenCalledOnce();
    expect(resolveSpeech).toBeDefined();
    resolveSpeech?.();
    await vi.waitFor(() => expect(
      runtime.getState().sceneIndex > 0 || runtime.getState().actionIndex > cursorBeforePause,
    ).toBe(true));
    await controller.dispose();
  });
});
