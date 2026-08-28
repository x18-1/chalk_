import { describe, expect, it, vi } from 'vitest';
import { openMaicStageFixture } from '../fixtures/openmaic-stage.js';
import { createChalkboardRuntime } from '../../src/runtime.js';
import { ChalkboardPlaybackController, type PlaybackExecutor } from '../../src/playback.js';
import type { StageDocument } from '../../src/schema.js';

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

  it('stops playback when the learner changes scenes with auto-play disabled', async () => {
    const runtime = createChalkboardRuntime(openMaicStageFixture);
    const executor = makeExecutor({
      speak: vi.fn(() => new Promise<void>(() => undefined)),
      cancel: vi.fn(),
    });
    const controller = new ChalkboardPlaybackController({
      runtime,
      executor,
      isAutoPlayEnabled: () => false,
    });

    await controller.start();
    await vi.waitFor(() => expect(executor.speak).toHaveBeenCalledTimes(1));
    await expect(controller.selectScene('scene-operation')).resolves.toEqual({ ok: true });

    expect(runtime.getState()).toMatchObject({
      sceneId: 'scene-operation',
      actionIndex: 0,
      mode: 'paused',
    });
    expect(executor.speak).toHaveBeenCalledTimes(1);
    await controller.dispose();
  });

  it('starts continuous playback from an authored note action', async () => {
    let resolveSpeech: (() => void) | undefined;
    const runtime = createChalkboardRuntime(openMaicStageFixture);
    const executor = makeExecutor({
      speak: vi.fn(() => new Promise<void>((resolve) => { resolveSpeech = resolve; })),
    });
    const controller = new ChalkboardPlaybackController({ runtime, executor });

    await expect(controller.playFrom('scene-operation', 0)).resolves.toEqual({ ok: true });

    expect(runtime.getState()).toMatchObject({
      sceneId: 'scene-operation',
      actionIndex: 0,
      mode: 'playing',
    });
    expect(executor.spotlight).not.toHaveBeenCalled();
    expect(executor.speak).toHaveBeenCalledWith('两边同时减去 3。');
    resolveSpeech?.();
    await controller.dispose();
  });

  it('restarts the playback loop when a note is selected during narration', async () => {
    let resolveSpeech: (() => void) | undefined;
    const runtime = createChalkboardRuntime(openMaicStageFixture);
    const executor = makeExecutor({
      speak: vi.fn(() => new Promise<void>((resolve) => { resolveSpeech = resolve; })),
      cancel: vi.fn(() => { resolveSpeech?.(); }),
    });
    const controller = new ChalkboardPlaybackController({ runtime, executor });

    await controller.start();
    await vi.waitFor(() => expect(executor.speak).toHaveBeenCalledTimes(1));
    await expect(controller.playFrom('scene-operation', 0)).resolves.toEqual({ ok: true });

    await vi.waitFor(() => expect(executor.speak).toHaveBeenCalledTimes(2));
    expect(executor.speak).toHaveBeenLastCalledWith('两边同时减去 3。');
    resolveSpeech?.();
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

  it('consumes an authored discussion action when opening it pauses playback', async () => {
    const document: StageDocument = {
      ...openMaicStageFixture,
      scenes: [{
        ...openMaicStageFixture.scenes[0]!,
        actions: [
          { id: 'discussion', type: 'discussion', topic: '为什么两边要同时变化？' },
          { id: 'after-discussion', type: 'speech', text: '继续看下一步。' },
        ],
      }],
    };
    const runtime = createChalkboardRuntime(document);
    let pausePlayback = async () => undefined;
    const executor = makeExecutor({
      pause: vi.fn(),
      discussion: vi.fn(() => pausePlayback()),
    });
    const controller = new ChalkboardPlaybackController({ runtime, executor });
    pausePlayback = () => controller.pause().then(() => undefined);

    await controller.start();
    await vi.waitFor(() => expect(runtime.getState().actionIndex).toBe(1));

    expect(runtime.getState()).toMatchObject({
      actionIndex: 1,
      currentAction: { id: 'after-discussion' },
      completed: false,
    });
    await controller.dispose();
  });

  it('persists every explicit playback mode transition', async () => {
    let resolveSpeech: (() => void) | undefined;
    const runtime = createChalkboardRuntime(openMaicStageFixture);
    const persistedModes: string[] = [];
    const controller = new ChalkboardPlaybackController({
      runtime,
      executor: makeExecutor({
        speak: vi.fn(() => new Promise<void>((resolve) => { resolveSpeech = resolve; })),
        pause: vi.fn(),
        resume: vi.fn(),
      }),
      persist: async () => { persistedModes.push(runtime.getSnapshot().mode); },
    });

    await controller.start();
    await vi.waitFor(() => expect(resolveSpeech).toBeDefined());
    expect(persistedModes.at(-1)).toBe('playing');
    await controller.pause();
    expect(persistedModes.at(-1)).toBe('paused');
    await controller.resume();
    expect(persistedModes.at(-1)).toBe('playing');

    resolveSpeech?.();
    await controller.dispose();
  });
});
