import { apiJson, ApiRequestError } from './client';
import type { ClassroomSummary } from './classrooms';

export type ClassroomSceneOutline = {
  id: string;
  type: 'slide' | 'quiz' | 'interactive' | 'pbl';
  title: string;
  description: string;
  keyPoints: string[];
  order: number;
  mediaGenerations?: Array<{
    type: 'image' | 'video';
    prompt: string;
    elementId: string;
    aspectRatio?: MediaAspectRatio;
    style?: string;
  }>;
  quizConfig?: {
    questionCount: number;
    difficulty: 'easy' | 'medium' | 'hard';
    questionTypes: Array<'single' | 'multiple' | 'text'>;
  };
};

export type ClassroomGeneratedScene = {
  id: string;
  outlineId: string;
  type: ClassroomSceneOutline['type'];
  order: number;
  outline: ClassroomSceneOutline;
  content: Record<string, unknown> | null;
  actions: Array<Record<string, unknown>> | null;
  status: 'pending' | 'running' | 'completed' | 'failed';
  attempt: number;
  prompt: { id: string; revision: string } | null;
  model: { providerId: string; modelId: string } | null;
  error: { code: string } | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ClassroomGenerationRun = {
  id: string;
  draftId: string;
  stage: 'outline' | 'scene_content' | 'scene_actions' | 'media_tasks';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted';
  attempt: number;
  requirements: string;
  context: { sourceText?: string; media?: ClassroomMediaPlanning };
  prompt: { id: string; revision: string } | null;
  model: { providerId: string; modelId: string } | null;
  outline: {
    languageDirective: string;
    courseTitle: string;
    outlines: ClassroomSceneOutline[];
  } | null;
  scenes: ClassroomGeneratedScene[];
  mediaTasks: Array<{
    id: string;
    sceneId: string;
    actionId: string | null;
    elementId: string | null;
    providerTaskId: string | null;
    kind: 'audio' | 'image' | 'video';
    status: 'pending' | 'running' | 'completed' | 'failed';
    attempt: number;
    providerId: string | null;
    modelId: string | null;
    mediaRef: string | null;
    contentType: string | null;
    size: number | null;
    error: { code: string } | null;
    startedAt: string | null;
    finishedAt: string | null;
  }>;
  progress: {
    total: number;
    completed: number;
    failed: number;
    currentSceneId: string | null;
  } | null;
  error: { code: string } | null;
  cancelRequested: boolean;
  startedAt: string | null;
  finishedAt: string | null;
};

type MediaAspectRatio = '16:9' | '4:3' | '1:1' | '9:16' | '3:4' | '21:9';
export type ClassroomMediaPlanning = {
  image?: { providerId: string; model?: string; aspectRatio?: MediaAspectRatio };
  video?: { providerId: string; model?: string; aspectRatio?: MediaAspectRatio; durationSeconds?: number; resolution?: '720p' | '1080p' };
};

export const classroomGenerationApi = {
  current(signal?: AbortSignal) {
    return apiJson<{ generationRun: ClassroomGenerationRun | null }>(
      '/classroom-generation-runs/current',
      { signal },
    );
  },
  create(input: { requirements: string; context?: { sourceText?: string }; media?: ClassroomMediaPlanning }, signal?: AbortSignal) {
    return apiJson<{ generationRun: ClassroomGenerationRun }>('/classroom-generation-runs', {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    });
  },
  get(runId: string, signal?: AbortSignal) {
    return apiJson<{ generationRun: ClassroomGenerationRun }>(
      `/classroom-generation-runs/${encodeURIComponent(runId)}`,
      { signal },
    );
  },
  retry(runId: string, signal?: AbortSignal) {
    return apiJson<{ generationRun: ClassroomGenerationRun }>(
      `/classroom-generation-runs/${encodeURIComponent(runId)}/retry`,
      { method: 'POST', signal },
    );
  },
  createSceneContent(runId: string, signal?: AbortSignal) {
    return apiJson<{ generationRun: ClassroomGenerationRun }>(
      `/classroom-generation-runs/${encodeURIComponent(runId)}/scene-content`,
      { method: 'POST', signal },
    );
  },
  createSceneActions(runId: string, signal?: AbortSignal) {
    return apiJson<{ generationRun: ClassroomGenerationRun }>(
      `/classroom-generation-runs/${encodeURIComponent(runId)}/scene-actions`,
      { method: 'POST', signal },
    );
  },
  createMediaTasks(runId: string, input: {
    tts?: { providerId: string; voice: string; model?: string; format?: 'mp3' | 'opus' | 'wav' | 'aac' | 'flac' | 'pcm' };
  }, signal?: AbortSignal) {
    return apiJson<{ generationRun: ClassroomGenerationRun }>(
      `/classroom-generation-runs/${encodeURIComponent(runId)}/media-tasks`,
      { method: 'POST', body: JSON.stringify(input), signal },
    );
  },
  publish(runId: string, signal?: AbortSignal) {
    return apiJson<{ created: boolean; classroom: ClassroomSummary }>(
      `/classroom-generation-runs/${encodeURIComponent(runId)}/publish`,
      { method: 'POST', signal },
    );
  },
  abort(runId: string, signal?: AbortSignal) {
    return apiJson<{ generationRun: ClassroomGenerationRun }>(
      `/classroom-generation-runs/${encodeURIComponent(runId)}/abort`,
      { method: 'POST', signal },
    );
  },
};

export function classroomGenerationErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return '登录状态已失效，请重新登录后再生成。';
    if (error.status === 409) return '这个生成任务当前不能执行该操作，请刷新进度后再试。';
    if (error.status === 429) return '模型请求过于频繁，请稍后再试。';
    if (error.code === 'CLASSROOM_OUTLINE_INVALID') return '模型返回的大纲没有通过校验，可以在同一任务上重试。';
    if (error.code === 'CLASSROOM_SCENE_CONTENT_UNSUPPORTED') return '大纲中还有暂未迁移的场景类型；已完成内容会保留，后续可以继续补生成。';
    if (error.code === 'CLASSROOM_SCENE_ACTIONS_UNSUPPORTED') return '当前场景类型的课堂动作尚未迁移；已经生成的动作会保留。';
    if (error.code === 'PROVIDER_NOT_CONFIGURED') return '所选媒体 Provider 尚未配置，请先在设置中保存凭据。';
    if (error.code === 'CLASSROOM_MEDIA_GENERATION_FAILED') return '部分课堂媒体生成失败；已完成项目会保留，可以继续补生成。';
    if (error.code === 'CLASSROOM_DRAFT_NOT_READY') return '课堂内容或媒体还没有全部完成，请先补齐未完成项目。';
    if (error.code === 'CLASSROOM_PUBLICATION_IN_PROGRESS') return '课堂正在由另一个请求发布，请稍后再试。';
    if (error.code === 'CLASSROOM_DRAFT_INVALID') return '课堂没有通过最终内容校验；草稿仍然保留，可以修复后重试发布。';
    if (error.code === 'CLASSROOM_MEDIA_PROMOTION_FAILED' || error.code === 'CLASSROOM_MEDIA_PROMOTION_UNAVAILABLE') {
      return '课堂媒体暂时无法发布；草稿和已生成媒体都已保留，请稍后重试。';
    }
    if (error.status >= 500) return '课堂生成服务暂时不可用，请稍后重试。';
  }
  if (error instanceof TypeError && typeof navigator !== 'undefined' && !navigator.onLine) {
    return '当前处于离线状态。恢复网络连接后再生成。';
  }
  return error instanceof Error ? error.message : '大纲生成失败，请稍后重试。';
}
