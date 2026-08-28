import { apiJson, apiUrl, ApiRequestError } from './client';
import type { ClassroomSummary } from './classrooms';

export type ClassroomSceneOutline = {
  id: string;
  type: 'slide' | 'quiz' | 'interactive';
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
  interactiveConfig?: Record<string, unknown>;
  widgetType?: 'simulation' | 'diagram' | 'code' | 'game' | 'visualization3d';
  widgetOutline?: Record<string, unknown>;
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
  phase: 'content' | 'actions' | 'completed';
  attempt: number;
  prompt: { id: string; revision: string } | null;
  model: { providerId: string; modelId: string } | null;
  error: { code: string } | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ClassroomGenerationRun = {
  id: string;
  classroomId: string | null;
  draftId: string;
  outlineRevisionId: string | null;
  draftStatus: string;
  stage: 'outline' | 'scene_content' | 'scene_actions' | 'media_tasks' | 'progressive';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted';
  attempt: number;
  requirements: string;
  context: {
    sourceText?: string;
    media?: ClassroomMediaPlanning;
    agentProfiles?: Array<{
      id: string;
      name: string;
      role: 'teacher' | 'assistant' | 'student';
      persona: string;
      priority: number;
    }>;
    agentProfileGeneration?: {
      source: 'model' | 'fallback';
      promptId: string;
      promptRevision: string;
      providerId?: string;
      modelId?: string;
    };
  };
  candidateVersion: string | null;
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
    url: string | null;
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
    media: { total: number; completed: number; failed: number } | null;
  } | null;
  previewReady: boolean;
  publishReady: boolean;
  error: { code: string } | null;
  cancelRequested: boolean;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ClassroomOutlineStreamEvent =
  | { type: 'languageDirective'; data: string }
  | { type: 'courseTitle'; data: string }
  | { type: 'outline'; data: ClassroomSceneOutline; index: number }
  | { type: 'retry'; attempt: number; maxAttempts: number }
  | {
      type: 'done';
      outlines: ClassroomSceneOutline[];
      languageDirective: string;
      courseTitle: string;
    }
  | { type: 'error'; error: string };

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
  confirmOutline(runId: string, input: {
    idempotencyKey: string;
    candidateVersion: string;
    outline: NonNullable<ClassroomGenerationRun['outline']>;
  }, signal?: AbortSignal) {
    return apiJson<{
      created: boolean;
      outlineRevision: { id: string; number: number; contentHash: string; createdAt: string };
      generationRun: ClassroomGenerationRun;
    }>(`/classroom-generation-runs/${encodeURIComponent(runId)}/outline-revisions`, {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    });
  },
  async streamOutline(
    runId: string,
    onEvent: (event: ClassroomOutlineStreamEvent, eventId: string) => void,
    signal?: AbortSignal,
    lastEventId?: string,
  ) {
    const response = await fetch(apiUrl(`/classroom-generation-runs/${encodeURIComponent(runId)}/outline-events`), {
      credentials: 'include',
      headers: {
        Accept: 'text/event-stream',
        ...(lastEventId ? { 'Last-Event-ID': lastEventId } : {}),
      },
      signal,
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
      throw new ApiRequestError(response.status, body.error ?? `Request failed (${response.status})`, body.code);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const id = frame.match(/^id: (\d+)$/m)?.[1];
        const data = frame.match(/^data: (.+)$/m)?.[1];
        if (id && data) onEvent(JSON.parse(data) as ClassroomOutlineStreamEvent, id);
      }
      if (done) break;
    }
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
    if (error.code === 'CLASSROOM_OUTLINE_TYPE_UNSUPPORTED') return 'PBL 不在 Chalkboard V3 的生成范围内，请改用讲解、小测或互动场景。';
    if (error.code === 'CLASSROOM_OUTLINE_REVISION_CONFLICT') return '这份大纲已经用另一版内容确认，请刷新后继续。';
    if (error.code === 'CLASSROOM_PROGRESSIVE_GENERATION_FAILED') return '课堂生成在当前场景中断；已完成场景和媒体均已保留，可以继续重试。';
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
