import { z } from 'zod';

import { httpUrlSchema } from '../../http/validation';
import { MODEL_THINKING_LEVELS } from '../../providers/llm/model-catalog';

export const providerParamsSchema = z.object({
  providerId: z.string().min(1).max(100),
});

export const customProviderParamsSchema = z.object({ id: z.string().uuid() });

export const modelSelectionSchema = z.object({
  providerId: z.string().min(1).max(100),
  modelId: z.string().min(1).max(200),
  thinkingLevel: z.enum(MODEL_THINKING_LEVELS),
});

export const providerCredentialSchema = z.object({
  apiKey: z.string().trim().min(1).max(10_000),
});

export const providerTestSchema = z.object({
  modelId: z.string().min(1).max(200),
});

export const customProviderModelSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(200),
  reasoning: z.boolean().default(false),
  input: z.array(z.enum(['text', 'image'])).min(1).max(2).default(['text']),
  contextWindow: z.number().int().min(1_024).max(100_000_000),
  maxTokens: z.number().int().min(1).max(10_000_000),
  cost: z.object({
    input: z.number().min(0),
    output: z.number().min(0),
    cacheRead: z.number().min(0),
    cacheWrite: z.number().min(0),
  }),
});

export const customProviderSchema = z.object({
  name: z.string().trim().min(1).max(100),
  baseUrl: httpUrlSchema,
  api: z.literal('openai-completions').default('openai-completions'),
  apiKey: z.string().trim().max(10_000).optional(),
  models: z.array(customProviderModelSchema).min(1).max(200),
  enabled: z.boolean().default(true),
});

export const customProviderUpdateSchema = customProviderSchema.partial();

export const modelsQuerySchema = z.object({
  provider: z.string().min(1).max(100).optional(),
});

export const skillSettingSchema = z.object({
  skillName: z.string().min(1).max(64),
  enabled: z.boolean(),
});

export const toolSettingSchema = z.object({
  toolName: z.string().min(1).max(200),
  enabled: z.boolean(),
  approval: z.enum(['default', 'always', 'never']).default('default'),
});

export type CustomProviderInput = z.infer<typeof customProviderSchema>;
export type CustomProviderUpdateInput = z.infer<typeof customProviderUpdateSchema>;
export type SkillSettingInput = z.infer<typeof skillSettingSchema>;
export type ToolSettingInput = z.infer<typeof toolSettingSchema>;
