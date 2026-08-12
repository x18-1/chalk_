import type { Conversation } from '../api';

export function formatConversationTitle(conversation: Conversation) {
  return conversation.title?.trim() || '新的数学问题';
}

export function conversationGroup(updatedAt: string): '今天' | '昨天' | '过去 7 天' | '过去 30 天' {
  const value = new Date(updatedAt).getTime();
  const age = Math.max(0, Date.now() - value);
  const day = 24 * 60 * 60 * 1000;
  if (age < day) return '今天';
  if (age < day * 2) return '昨天';
  if (age < day * 7) return '过去 7 天';
  return '过去 30 天';
}
