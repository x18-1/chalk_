import { executeAction, type ActionExecutor, type ActionExecutionResult } from './adapter';
import type { Action } from './schema';
import {
  type ChalkboardRuntime,
  type RuntimeCommandResult,
  type RuntimeState,
} from './runtime';

export type PlaybackActionStatus = 'idle' | 'running' | 'paused' | 'error';

export interface PlaybackExecutor extends ActionExecutor {
  cancel?(reason?: string): void | Promise<void>;
  pause?(): void | Promise<void>;
  resume?(): void | Promise<void>;
}

export interface PlaybackState extends RuntimeState {
  actionStatus: PlaybackActionStatus;
  error: { actionType: string } | null;
}

export interface PlaybackControllerOptions {
  runtime: ChalkboardRuntime;
  executor: PlaybackExecutor;
  persist?: () => void | Promise<void>;
  onUnsupportedAction?: (actionType: string) => void;
  isAutoPlayEnabled?: () => boolean;
}

type PlaybackListener = (state: PlaybackState) => void;

/**
 * Deterministic lecture orchestration. Runtime owns the cursor and this
 * controller owns the asynchronous action lifecycle and cancellation token.
 */
export class ChalkboardPlaybackController {
  private executor: PlaybackExecutor;
  private readonly runtime: ChalkboardRuntime;
  private readonly persist?: () => void | Promise<void>;
  private readonly onUnsupportedAction?: (actionType: string) => void;
  private readonly isAutoPlayEnabled?: () => boolean;
  private readonly listeners = new Set<PlaybackListener>();
  private generation = 0;
  private loopPromise: Promise<void> | null = null;
  private activeAction: Action | null = null;
  private suspended = false;
  private actionStatus: PlaybackActionStatus = 'idle';
  private error: { actionType: string } | null = null;
  private disposed = false;

  constructor(options: PlaybackControllerOptions) {
    this.runtime = options.runtime;
    this.executor = options.executor;
    this.persist = options.persist;
    this.onUnsupportedAction = options.onUnsupportedAction;
    this.isAutoPlayEnabled = options.isAutoPlayEnabled;
  }

  /** Attach the controller to an already restored runtime. This explicit
   * lifecycle keeps restoration ordered after the presentation adapter has
   * mounted and reset its scene-scoped visual state. */
  async activate(): Promise<void> {
    if (this.disposed || this.runtime.getState().mode !== 'playing') return;
    this.actionStatus = 'running';
    this.emit();
    this.ensureLoop();
  }

  setExecutor(executor: PlaybackExecutor): void {
    this.executor = executor;
  }

  getState(): PlaybackState {
    return {
      ...this.runtime.getState(),
      actionStatus: this.actionStatus,
      error: this.error,
    };
  }

  subscribe(listener: PlaybackListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<RuntimeCommandResult> {
    if (this.disposed) return { ok: false, error: { code: 'INVALID_TRANSITION', command: 'start', mode: this.runtime.getState().mode } };
    const state = this.runtime.getState();
    const result = state.mode === 'paused' ? this.runtime.resume() : this.runtime.start();
    if (!result.ok) return result;
    this.error = null;
    if (this.suspended) {
      this.suspended = false;
      await this.executor.resume?.();
    }
    this.actionStatus = 'running';
    this.emit();
    this.ensureLoop();
    return result;
  }

  async pause(): Promise<RuntimeCommandResult> {
    const result = this.runtime.pause();
    if (!result.ok) return result;
    if (this.activeAction && this.executor.pause) {
      await this.executor.pause();
      this.suspended = true;
    } else {
      await this.cancelActive('playback paused');
    }
    this.actionStatus = 'paused';
    this.emit();
    return result;
  }

  async resume(): Promise<RuntimeCommandResult> {
    const result = this.runtime.resume();
    if (!result.ok) return result;
    if (this.suspended) {
      this.suspended = false;
      await this.executor.resume?.();
    }
    this.actionStatus = 'running';
    this.emit();
    this.ensureLoop();
    return result;
  }

  async next(): Promise<RuntimeCommandResult> {
    return this.navigate(() => this.runtime.next());
  }

  async nextScene(): Promise<RuntimeCommandResult> {
    return this.navigate(() => this.runtime.nextScene(), { executeCurrent: false });
  }

  async previous(): Promise<RuntimeCommandResult> {
    return this.navigate(() => this.runtime.previous());
  }

  async previousScene(): Promise<RuntimeCommandResult> {
    return this.navigate(() => this.runtime.previousScene(), { executeCurrent: false });
  }

  async jump(sceneId: string, actionIndex = 0): Promise<RuntimeCommandResult> {
    return this.navigate(() => this.runtime.jump(sceneId, actionIndex));
  }

  /** Select a page without replaying its first authored action. This is the
   * interaction used by the scene rail and previous/next page controls. */
  async selectScene(sceneId: string): Promise<RuntimeCommandResult> {
    return this.navigate(() => this.runtime.jump(sceneId, 0), { executeCurrent: false });
  }

  async restart(): Promise<RuntimeCommandResult> {
    await this.cancelActive('playback restarted');
    const result = this.runtime.restart();
    if (!result.ok) return result;
    this.error = null;
    this.actionStatus = 'idle';
    await this.persist?.();
    this.emit();
    await this.executeCurrent();
    return result;
  }

  async executeCurrent(): Promise<ActionExecutionResult | null> {
    const action = this.runtime.getState().currentAction;
    if (!action) {
      this.actionStatus = this.runtime.getState().completed ? 'idle' : 'error';
      this.emit();
      return null;
    }
    const generation = ++this.generation;
    await this.executor.cancel?.('replaying current action');
    if (this.disposed || generation !== this.generation) return null;
    this.activeAction = action;
    this.actionStatus = 'running';
    this.emit();
    const result = await executeAction(action, this.executor);
    if (generation !== this.generation || this.disposed) return result;
    this.activeAction = null;
    this.actionStatus = result.ok ? 'idle' : 'error';
    if (!result.ok) {
      this.error = { actionType: result.error.actionType };
      this.onUnsupportedAction?.(result.error.actionType);
    }
    await this.persist?.();
    this.emit();
    return result;
  }

  async cancel(reason = 'playback cancelled'): Promise<void> {
    await this.cancelActive(reason);
    this.actionStatus = 'idle';
    this.emit();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.cancelActive('playback disposed');
    this.listeners.clear();
  }

  private async navigate(
    operation: () => RuntimeCommandResult,
    options: { executeCurrent?: boolean } = {},
  ): Promise<RuntimeCommandResult> {
    const wasPlaying = this.runtime.getState().mode === 'playing';
    if (wasPlaying) this.runtime.pause();
    await this.cancelActive('playback navigation');
    const result = operation();
    if (!result.ok) return result;
    this.error = null;
    this.actionStatus = wasPlaying ? 'running' : 'idle';
    await this.persist?.();
    this.emit();
    if (wasPlaying) {
      this.runtime.start();
      this.ensureLoop();
    } else if (options.executeCurrent !== false) {
      await this.executeCurrent();
    }
    return result;
  }

  private ensureLoop(): void {
    if (this.loopPromise || this.disposed) return;
    const generation = this.generation;
    this.loopPromise = this.runLoop(generation).finally(() => {
      this.loopPromise = null;
      if (this.runtime.getState().mode === 'playing' && generation === this.generation) this.ensureLoop();
    });
  }

  private async runLoop(generation: number): Promise<void> {
    while (!this.disposed && generation === this.generation && this.runtime.getState().mode === 'playing') {
      const action = this.runtime.getState().currentAction;
      if (!action) {
        const advanced = this.runtime.next({ advanceScene: this.shouldAdvanceScene() });
        if (!advanced.ok) {
          this.actionStatus = 'error';
          this.emit();
          return;
        }
        this.actionStatus = 'idle';
        await this.persist?.();
        this.emit();
        if (this.runtime.getState().mode !== 'playing') return;
        continue;
      }
      this.activeAction = action;
      this.actionStatus = 'running';
      this.emit();
      const result = await executeAction(action, this.executor);
      if (this.disposed || generation !== this.generation || this.runtime.getState().mode !== 'playing') return;
      this.activeAction = null;
      if (!result.ok) {
        this.error = { actionType: result.error.actionType };
        this.onUnsupportedAction?.(result.error.actionType);
      } else {
        this.error = null;
      }
      const advanced = this.runtime.next({ advanceScene: this.shouldAdvanceScene() });
      if (!advanced.ok) {
        this.actionStatus = 'error';
        this.emit();
        return;
      }
      if (this.runtime.getState().mode !== 'playing') this.actionStatus = 'idle';
      await this.persist?.();
      this.emit();
    }
  }

  private async cancelActive(reason: string): Promise<void> {
    this.generation += 1;
    this.activeAction = null;
    this.suspended = false;
    await this.executor.cancel?.(reason);
  }

  private shouldAdvanceScene(): boolean {
    const state = this.runtime.getState();
    return state.sceneType === 'slide' && this.isAutoPlayEnabled?.() === true;
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }
}
