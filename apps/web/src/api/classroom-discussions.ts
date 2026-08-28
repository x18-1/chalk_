import type { Action, RuntimeSnapshot } from '@chalk/chalkboard';

import { apiJson, apiUrl, ApiRequestError } from './client';

export type ClassroomDiscussionTarget = {
  kind: 'learning_session' | 'generation_run';
  id: string;
};

export type ClassroomDiscussionParticipant = {
  id: string;
  name: string;
  role: 'teacher' | 'assistant' | 'student';
  persona: string;
};

export type ClassroomDiscussionMessage = {
  id: string;
  roundId: string;
  sequence: number;
  sender: 'student' | 'agent' | 'system';
  agentId: string | null;
  agentName: string | null;
  agentRole: string | null;
  content: string;
  actions: Action[];
  status: 'streaming' | 'completed' | 'interrupted';
  createdAt: string;
  updatedAt: string;
};

export type ClassroomDiscussion = {
  id: string;
  status: 'active' | 'completed' | 'aborted' | 'failed';
  sceneId: string;
  topic: string;
  prompt: string | null;
  triggerAgentId: string | null;
  target: ClassroomDiscussionTarget;
  participants: ClassroomDiscussionParticipant[];
  entryCursor: RuntimeSnapshot;
  messages: ClassroomDiscussionMessage[];
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

export type ClassroomDiscussionStreamEvent =
  | { type: 'round_started'; roundId: string }
  | {
      type: 'agent_started';
      roundId: string;
      messageId: string;
      sequence: number;
      agentId: string;
      agentName: string;
      agentRole: ClassroomDiscussionParticipant['role'];
    }
  | { type: 'text_delta'; roundId: string; messageId: string; sequence: number; delta: string }
  | {
      type: 'action';
      roundId: string;
      messageId: string;
      sequence: number;
      agentId: string;
      action: Action;
    }
  | { type: 'message_completed'; roundId: string; message: ClassroomDiscussionMessage }
  | { type: 'awaiting_student'; roundId: string; fromAgentId?: string }
  | { type: 'round_completed'; roundId: string; status: 'completed' | 'aborted' }
  | { type: 'error'; error: string; code: string; retryable: boolean };

async function streamRound(
  discussionId: string,
  input: { message?: string },
  onEvent: (event: ClassroomDiscussionStreamEvent) => void,
  signal?: AbortSignal,
) {
  const response = await fetch(apiUrl(`/classroom-discussions/${encodeURIComponent(discussionId)}/rounds/stream`), {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => ({})) as { error?: string; code?: string };
    throw new ApiRequestError(response.status, body.error ?? `Request failed (${response.status})`, body.code);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let streamFailure: { error: string; code: string } | null = null;
  const consume = (frame: string) => {
    const type = frame.match(/^event: ([^\n]+)$/m)?.[1];
    const data = frame.match(/^data: (.+)$/m)?.[1];
    if (!type || !data) return;
    const event = { ...(JSON.parse(data) as Record<string, unknown>), type } as ClassroomDiscussionStreamEvent;
    onEvent(event);
    if (event.type === 'error') streamFailure = { error: event.error, code: event.code };
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) consume(frame);
    if (done) break;
  }
  if (buffer.trim()) consume(buffer);
  const failure = streamFailure as { error: string; code: string } | null;
  if (failure) {
    throw new ApiRequestError(502, failure.error, failure.code);
  }
}

export const classroomDiscussionsApi = {
  createOrResume(input: {
    target: ClassroomDiscussionTarget;
    sceneId: string;
    topic: string;
    prompt?: string;
    triggerAgentId?: string;
    entryCursor?: RuntimeSnapshot;
  }, signal?: AbortSignal) {
    return apiJson<{ discussion: ClassroomDiscussion; created: boolean }>('/classroom-discussions', {
      method: 'POST',
      body: JSON.stringify({
        kind: input.target.kind,
        id: input.target.id,
        sceneId: input.sceneId,
        topic: input.topic,
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.triggerAgentId ? { triggerAgentId: input.triggerAgentId } : {}),
        ...(input.entryCursor ? { entryCursor: input.entryCursor } : {}),
      }),
      signal,
    });
  },
  current(target: ClassroomDiscussionTarget, sceneId: string, signal?: AbortSignal) {
    const query = new URLSearchParams({ kind: target.kind, id: target.id, sceneId });
    return apiJson<{ discussion: ClassroomDiscussion | null }>(
      `/classroom-discussions/current?${query.toString()}`,
      { signal },
    );
  },
  get(discussionId: string, signal?: AbortSignal) {
    return apiJson<{ discussion: ClassroomDiscussion }>(
      `/classroom-discussions/${encodeURIComponent(discussionId)}`,
      { signal },
    );
  },
  streamRound,
  abort(discussionId: string, signal?: AbortSignal) {
    return apiJson<{ ok: true }>(`/classroom-discussions/${encodeURIComponent(discussionId)}/abort`, {
      method: 'POST',
      signal,
    });
  },
  complete(discussionId: string, signal?: AbortSignal) {
    return apiJson<{ discussion: ClassroomDiscussion; entryCursor: RuntimeSnapshot }>(
      `/classroom-discussions/${encodeURIComponent(discussionId)}/complete`,
      { method: 'POST', signal },
    );
  },
};

export function classroomDiscussionErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return '登录状态已失效，请重新登录后继续讨论。';
    if (error.status === 404) return '这条课堂讨论已经不存在，或不属于当前课堂。';
    if (error.code === 'CLASSROOM_DISCUSSION_ROUND_ACTIVE') return '上一轮还在回答，请先等待或停止这一轮。';
    if (error.code === 'CLASSROOM_DISCUSSION_SCENE_INVALID' || error.code === 'CLASSROOM_DISCUSSION_CURSOR_INVALID') {
      return '课堂位置已经变化，请刷新后在当前场景重新开始讨论。';
    }
    if (error.status === 429) return '课堂 Agent 暂时繁忙，请稍后再试。';
    if (error.status >= 500) return '课堂 Agent 暂时没有完成回答；已经出现的内容仍会保留，可以重试。';
  }
  if (error instanceof DOMException && error.name === 'AbortError') return '这一轮已停止，已经出现的内容仍会保留。';
  if (error instanceof TypeError && typeof navigator !== 'undefined' && !navigator.onLine) {
    return '当前处于离线状态。恢复网络后可以继续同一条讨论。';
  }
  return error instanceof Error ? error.message : '课堂讨论暂时不可用，请稍后重试。';
}
