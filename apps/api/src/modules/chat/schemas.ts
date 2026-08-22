import { z } from 'zod';

import { MODEL_THINKING_LEVELS } from '../../providers/llm/model-catalog';

export const conversationParamsSchema = z.object({ id: z.string().uuid() });

export const conversationListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(160).optional(),
});

export const renameConversationSchema = z.object({
  title: z.string().trim().min(1).max(160),
});

const modelSelectionSchema = z.object({
  providerId: z.string().min(1).max(100),
  modelId: z.string().min(1).max(200),
  thinkingLevel: z.enum(MODEL_THINKING_LEVELS),
});

export const chatStreamSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
  model: modelSelectionSchema.optional(),
  attachmentIds: z.array(z.string().uuid()).max(4).default([]),
});

export const steerRunSchema = z.object({
  message: z.string().trim().min(1).max(20_000),
});

export const toolDecisionSchema = z.object({
  toolCallId: z.string().min(1).max(200),
  approved: z.boolean(),
});
