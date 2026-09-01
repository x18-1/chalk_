import { Buffer } from 'node:buffer';
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

export const memorySettingsSchema = z.object({
  enabled: z.boolean(),
}).strict();

const mediaSelectionSchema = z.object({
  providerId: z.string().trim().min(1).max(100),
  modelId: z.string().trim().min(1).max(200).nullable(),
}).strict();

export const capabilitySettingsSchema = z.object({
  image: mediaSelectionSchema.nullable().optional(),
  video: mediaSelectionSchema.extend({
    durationSeconds: z.number().int().min(5).max(20),
    resolution: z.enum(['720p', '1080p']),
  }).strict().nullable().optional(),
  speech: z.object({
    adapter: z.literal('browser'),
    language: z.string().trim().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).max(35),
    voiceUri: z.string().trim().min(1).max(500).nullable(),
    rate: z.number().min(0.5).max(2),
    volume: z.number().min(0).max(1),
  }).strict().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one capability setting is required');

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
export const skillNameParamsSchema = z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/) });

const MAX_USER_SKILL_REFERENCES = 32;
const MAX_USER_SKILL_REFERENCES_BYTES = 512 * 1024;
const userSkillReferencePathSchema = z.string().max(256).refine((path) => {
  const segments = path.split('/');
  return segments[0] === 'references'
    && segments.length >= 2
    && segments.every((segment) => Boolean(segment) && segment !== '.' && segment !== '..' && /^[A-Za-z0-9._-]+$/.test(segment));
}, 'Reference path must identify a file within references/ without dot segments');
const userSkillReferencesSchema = z.record(
  userSkillReferencePathSchema,
  z.string().max(64 * 1024),
).superRefine((references, context) => {
  const entries = Object.entries(references);
  if (entries.length > MAX_USER_SKILL_REFERENCES) {
    context.addIssue({
      code: 'custom',
      message: `A user Skill can contain at most ${MAX_USER_SKILL_REFERENCES} references`,
    });
  }
  const totalBytes = entries.reduce(
    (total, [path, content]) => total + Buffer.byteLength(path) + Buffer.byteLength(content),
    0,
  );
  if (totalBytes > MAX_USER_SKILL_REFERENCES_BYTES) {
    context.addIssue({
      code: 'custom',
      message: `User Skill references can contain at most ${MAX_USER_SKILL_REFERENCES_BYTES} bytes in total`,
    });
  }
});
const userSkillFields = {
  name: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
  description: z.string().trim().min(1).max(500),
  content: z.string().min(1).max(64 * 1024),
  references: userSkillReferencesSchema,
  version: z.string().trim().min(1).max(64),
  enabled: z.boolean(),
};

export const userSkillCreateSchema = z.object({
  ...userSkillFields,
  references: userSkillReferencesSchema.default({}),
  version: userSkillFields.version.default('1.0.0'),
  enabled: userSkillFields.enabled.default(true),
}).strict();

export const userSkillUpdateSchema = z.object(userSkillFields).partial().strict();
export const userSkillParamsSchema = z.object({ id: z.string().uuid() });

export const toolSettingSchema = z.object({
  toolName: z.string().min(1).max(200),
  enabled: z.boolean(),
  approval: z.enum(['default', 'always', 'never']).default('default'),
});

export const ragSettingsSchema = z.object({
  embedding: z.object({
    model: z.string().trim().min(1).max(200),
    baseUrl: httpUrlSchema.optional().or(z.literal('')),
    apiKey: z.string().trim().max(10_000).optional(),
  }).strict().optional(),
  rerank: z.object({
    model: z.string().trim().min(1).max(200),
    url: httpUrlSchema.optional().or(z.literal('')),
    apiKey: z.string().trim().max(10_000).optional(),
  }).strict().optional(),
  pdf: z.object({
    engine: z.enum(['text_only', 'markitdown', 'mineru']),
    mode: z.enum(['local', 'cloud']),
    modelVersion: z.string().trim().min(1).max(100),
    ocr: z.boolean(),
    formula: z.boolean(),
    table: z.boolean(),
    language: z.string().trim().max(20),
    apiToken: z.string().trim().max(10_000).optional(),
  }).strict().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one RAG setting is required');

export type CustomProviderInput = z.infer<typeof customProviderSchema>;
export type CustomProviderUpdateInput = z.infer<typeof customProviderUpdateSchema>;
export type CapabilitySettingsInput = z.infer<typeof capabilitySettingsSchema>;
export type SkillSettingInput = z.infer<typeof skillSettingSchema>;
export type UserSkillCreateInput = z.infer<typeof userSkillCreateSchema>;
export type UserSkillUpdateInput = z.infer<typeof userSkillUpdateSchema>;
export type ToolSettingInput = z.infer<typeof toolSettingSchema>;
export type RagSettingsInput = z.infer<typeof ragSettingsSchema>;
