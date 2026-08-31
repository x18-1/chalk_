export { ApiRequestError } from './client';
export { authApi, type AuthUser } from './auth';
export { adminApi, type AdminUser } from './admin';
export {
  chatApi,
  type ChatMessage,
  type ChatModel,
  type ChatStreamEvent,
  type Conversation,
  type ModelRef,
  type ModelSelection,
  type ThinkingLevel,
} from './chat';
export {
  settingsApi,
  type CustomModel,
  type BrowserSpeechSettings,
  type CapabilitySettings,
  type CapabilitySettingsInput,
  type MediaCapabilitySelection,
  type McpServer,
  type Model,
  type Provider,
  type Skill,
  type SkillDetails,
  type Tool,
  type VideoCapabilitySelection,
} from './settings';
export { uploadsApi } from './uploads';
export { mediaApi, type MediaCapability, type MediaProvider, type MediaProviders } from './media';
export {
  classroomErrorMessage,
  classroomImportErrorMessage,
  classroomsApi,
  type ClassroomArtifact,
  type ClassroomSummary,
} from './classrooms';
export {
  classroomGenerationApi,
  classroomGenerationErrorMessage,
  type ClassroomGenerationRun,
  type ClassroomOutlineStreamEvent,
  type ClassroomGeneratedScene,
  type ClassroomSceneOutline,
} from './classroom-generation';
export {
  learningSessionsApi,
  type LearningSession,
} from './learning-sessions';
export {
  quizAttemptsApi,
  type QuizAttempt,
  type QuizQuestionResult,
} from './quiz-attempts';
export {
  classroomDiscussionsApi,
  classroomDiscussionErrorMessage,
  type ClassroomDiscussion,
  type ClassroomDiscussionMessage,
  type ClassroomDiscussionParticipant,
  type ClassroomDiscussionStreamEvent,
  type ClassroomDiscussionTarget,
} from './classroom-discussions';
export {
  telemetryApi,
  type AgentRun,
  type AgentRunStatus,
  type ConversationObservationDetail,
  type ConversationObservationSummary,
} from './telemetry';
