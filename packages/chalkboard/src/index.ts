// Chalkboard owns the reusable lesson model, playback runtime, rendering, and interactions.
// The implementation will be migrated from OpenMAIC and extended with Chalk teaching semantics.
export {
  ActionSchema,
  SceneContentSchema,
  SceneSchema,
  StageDocumentSchema,
  StageMetadataSchema,
  StageSchema,
  parseStageDocument,
  validateStageDocument,
} from './schema';
export type { Action, CanvasElement, QuizQuestion, Scene, SceneType, SlideContent, Stage, StageDocument } from './schema';
export { classroomPackageMediaReferences, normalizeClassroomPackageManifest } from './import/classroom-package';
export type { ClassroomPackageManifest, ClassroomPackageOptions } from './import/classroom-package';
export { ChalkboardRuntime, createChalkboardRuntime } from './runtime';
export type {
  RuntimeCommandResult,
  RuntimeError,
  RuntimeMode,
  RuntimeSnapshot,
  RuntimeState,
} from './runtime';
export { ChalkboardPlaybackController } from './playback';
export type {
  PlaybackActionStatus,
  PlaybackControllerOptions,
  PlaybackExecutor,
  PlaybackState,
} from './playback';
export {
  CursorSnapshotSchema,
  clearCursor,
  clearCursorSnapshot,
  loadCursor,
  loadCursorSnapshot,
  saveCursor,
  saveCursorSnapshot,
} from './cursor';
export type { CursorSnapshotStore } from './cursor.js';
export {
  adaptOpenMaicClassroomResponse,
  executeAction,
  normalizeClassroomDocument,
  toActionEffect,
  toSceneView,
} from './adapter';
export {
  applyLiveChalkboardAction,
  emptyScenePresentation,
  projectScenePresentation,
} from './presentation-state';
export type {
  ScenePresentationState,
  LiveChalkboardPresentationState,
  WidgetPresentationState,
} from './presentation-state';
export {
  applyLiveChalkboardCommand,
  describeChalkboardState,
  emptyChalkboardState,
  replayLiveChalkboardActions,
} from './live-chalkboard';
export type { LiveChalkboardAction, LiveChalkboardRejection } from './live-chalkboard';
export type {
  ActionEffect,
  ActionExecutionResult,
  ActionExecutor,
  AdaptedClassroom,
  SceneView,
} from './adapter';
