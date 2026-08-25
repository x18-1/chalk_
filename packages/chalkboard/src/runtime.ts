import { parseStageDocument, type Action, type Scene, type StageDocument, type SceneType } from './schema';

export type RuntimeMode = 'idle' | 'playing' | 'paused' | 'completed';

export interface RuntimeState {
  mode: RuntimeMode;
  stageId: string;
  sceneId: string | null;
  sceneIndex: number;
  actionIndex: number;
  currentAction: Action | null;
  completed: boolean;
}

export interface RuntimeSnapshot {
  version: 1;
  stageId: string;
  sceneId: string | null;
  sceneIndex: number;
  actionIndex: number;
  mode: RuntimeMode;
  completed: boolean;
}

export type RuntimeError =
  | { code: 'INVALID_TRANSITION'; command: string; mode: RuntimeMode }
  | { code: 'SCENE_NOT_FOUND'; sceneId: string }
  | { code: 'INVALID_ACTION_CURSOR'; sceneId: string; actionIndex: number }
  | { code: 'INVALID_SNAPSHOT'; reason: string }
  | { code: 'UNSUPPORTED_SCENE_TYPE'; sceneId: string; sceneType: 'pbl' };

export type RuntimeCommandResult = { ok: true } | { ok: false; error: RuntimeError };

export function createChalkboardRuntime(input: unknown): ChalkboardRuntime {
  return new ChalkboardRuntime(parseStageDocument(input));
}

export class ChalkboardRuntime {
  private readonly document: StageDocument;
  private readonly scenes: readonly Scene[];
  private mode: RuntimeMode = 'idle';
  private sceneIndex = 0;
  private actionIndex = 0;
  private completed = false;

  constructor(document: StageDocument) {
    this.document = document;
    this.scenes = [...document.scenes].sort((left, right) => left.order - right.order);
  }

  getState(): RuntimeState {
    const scene = this.currentScene();
    return {
      mode: this.mode,
      stageId: this.document.stage.id,
      sceneId: scene?.id ?? null,
      sceneIndex: this.sceneIndex,
      actionIndex: this.actionIndex,
      currentAction: scene?.actions?.[this.actionIndex] ?? null,
      completed: this.completed,
    };
  }

  getSnapshot(): RuntimeSnapshot {
    const state = this.getState();
    return {
      version: 1,
      stageId: state.stageId,
      sceneId: state.sceneId,
      sceneIndex: state.sceneIndex,
      actionIndex: state.actionIndex,
      mode: state.mode,
      completed: state.completed,
    };
  }

  start(): RuntimeCommandResult {
    if (this.mode !== 'idle' && this.mode !== 'paused') return this.invalid('start');
    this.completed = false;
    this.mode = 'playing';
    return { ok: true };
  }

  pause(): RuntimeCommandResult {
    if (this.mode !== 'playing') return this.invalid('pause');
    this.mode = 'paused';
    return { ok: true };
  }

  resume(): RuntimeCommandResult {
    if (this.mode !== 'paused') return this.invalid('resume');
    this.mode = 'playing';
    return { ok: true };
  }

  next(): RuntimeCommandResult {
    if (this.mode === 'completed') return this.invalid('next');
    const scene = this.currentScene();
    if (!scene) return this.invalid('next');
    const actionCount = scene.actions?.length ?? 0;
    if (this.actionIndex < actionCount - 1) {
      this.actionIndex += 1;
      return { ok: true };
    }
    if (this.sceneIndex < this.scenes.length - 1) {
      const nextScene = this.scenes[this.sceneIndex + 1]!;
      const unsupported = this.unsupported(nextScene);
      if (unsupported) return { ok: false, error: unsupported };
      this.sceneIndex += 1;
      this.actionIndex = 0;
      return { ok: true };
    }
    this.completed = true;
    this.mode = 'completed';
    this.actionIndex = actionCount;
    return { ok: true };
  }

  /** Move to the next authored scene, without consuming an action in it. */
  nextScene(): RuntimeCommandResult {
    if (this.sceneIndex >= this.scenes.length - 1) {
      this.completed = true;
      this.mode = 'completed';
      this.actionIndex = this.currentScene()?.actions?.length ?? 0;
      return { ok: true };
    }
    const nextScene = this.scenes[this.sceneIndex + 1]!;
    const unsupported = this.unsupported(nextScene);
    if (unsupported) return { ok: false, error: unsupported };
    this.sceneIndex += 1;
    this.actionIndex = 0;
    this.completed = false;
    if (this.mode === 'completed') this.mode = 'paused';
    return { ok: true };
  }

  previous(): RuntimeCommandResult {
    if (this.actionIndex > 0) {
      this.actionIndex -= 1;
      this.completed = false;
      if (this.mode === 'completed') this.mode = 'paused';
      return { ok: true };
    }
    if (this.sceneIndex === 0) return { ok: true };
    this.sceneIndex -= 1;
    const previousScene = this.currentScene()!;
    this.actionIndex = Math.max(0, (previousScene.actions?.length ?? 0) - 1);
    this.completed = false;
    if (this.mode === 'completed') this.mode = 'paused';
    return { ok: true };
  }

  /** Move to the previous authored scene, resetting its action cursor. */
  previousScene(): RuntimeCommandResult {
    if (this.sceneIndex === 0) return { ok: true };
    this.sceneIndex -= 1;
    const previousScene = this.currentScene()!;
    const unsupported = this.unsupported(previousScene);
    if (unsupported) {
      this.sceneIndex += 1;
      return { ok: false, error: unsupported };
    }
    this.actionIndex = 0;
    this.completed = false;
    if (this.mode === 'completed') this.mode = 'paused';
    return { ok: true };
  }

  jump(sceneId: string, actionIndex = 0): RuntimeCommandResult {
    const index = this.scenes.findIndex((scene) => scene.id === sceneId);
    if (index === -1) return { ok: false, error: { code: 'SCENE_NOT_FOUND', sceneId } };
    const scene = this.scenes[index]!;
    const unsupported = this.unsupported(scene);
    if (unsupported) return { ok: false, error: unsupported };
    const actionCount = scene.actions?.length ?? 0;
    if (!Number.isInteger(actionIndex) || actionIndex < 0 || actionIndex > actionCount) {
      return { ok: false, error: { code: 'INVALID_ACTION_CURSOR', sceneId, actionIndex } };
    }
    this.sceneIndex = index;
    this.actionIndex = actionIndex;
    this.completed = false;
    if (this.mode === 'completed') this.mode = 'paused';
    return { ok: true };
  }

  restart(): RuntimeCommandResult {
    this.sceneIndex = 0;
    this.actionIndex = 0;
    this.mode = 'idle';
    this.completed = false;
    return { ok: true };
  }

  complete(): RuntimeCommandResult {
    this.completed = true;
    this.mode = 'completed';
    return { ok: true };
  }

  restore(snapshot: RuntimeSnapshot): RuntimeCommandResult {
    if (snapshot.version !== 1 || snapshot.stageId !== this.document.stage.id) {
      return { ok: false, error: { code: 'INVALID_SNAPSHOT', reason: 'Snapshot does not belong to this Stage' } };
    }
    if (snapshot.sceneId === null) {
      this.sceneIndex = 0;
      this.actionIndex = 0;
    } else {
      const result = this.jump(snapshot.sceneId, snapshot.actionIndex);
      if (!result.ok) return result;
    }
    this.mode = snapshot.mode;
    this.completed = snapshot.completed;
    return { ok: true };
  }

  private currentScene(): Scene | undefined {
    return this.scenes[this.sceneIndex];
  }

  private unsupported(scene: Scene): Extract<RuntimeError, { code: 'UNSUPPORTED_SCENE_TYPE' }> | null {
    return scene.type === 'pbl'
      ? { code: 'UNSUPPORTED_SCENE_TYPE', sceneId: scene.id, sceneType: 'pbl' }
      : null;
  }

  private invalid(command: string): { ok: false; error: Extract<RuntimeError, { code: 'INVALID_TRANSITION' }> } {
    return { ok: false, error: { code: 'INVALID_TRANSITION', command, mode: this.mode } };
  }
}

export type { SceneType };
