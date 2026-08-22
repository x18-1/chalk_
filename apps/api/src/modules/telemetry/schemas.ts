import { z } from 'zod';

export const telemetryListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const telemetryConversationParamsSchema = z.object({
  conversationId: z.string().uuid(),
});

export const telemetryRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
});
