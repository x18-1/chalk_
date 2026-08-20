import { apiJson } from './client';

export type AgentRunStatus = 'completed' | 'aborted' | 'failed';

export type AgentRun = {
  id: string;
  conversationId: string;
  sessionId: string;
  modelProviderId: string | null;
  modelId: string | null;
  status: AgentRunStatus;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalCost: number | null;
  errorCategory: string | null;
  startedAt: string;
  finishedAt: string;
};

export type ConversationObservationSummary = {
  conversationId: string;
  title: string | null;
  sessionId: string;
  runCount: number;
  statusCounts: Record<AgentRunStatus, number>;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  firstStartedAt: string;
  lastStartedAt: string;
  latestErrorCategory: string | null;
};

export type ConversationObservationDetail = {
  summary: ConversationObservationSummary | null;
  runs: AgentRun[];
};

export const telemetryApi = {
  listConversations(signal?: AbortSignal) {
    return apiJson<{ conversations: ConversationObservationSummary[] }>('/telemetry/conversations', { signal });
  },

  getConversation(conversationId: string, signal?: AbortSignal) {
    return apiJson<ConversationObservationDetail>(`/telemetry/conversations/${encodeURIComponent(conversationId)}`, { signal });
  },
};
