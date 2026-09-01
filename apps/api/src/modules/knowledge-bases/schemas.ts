import { z } from 'zod';

const contentTypes = [
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export const knowledgeBaseIdParamsSchema = z.object({ id: z.string().uuid() });
export const knowledgeDocumentParamsSchema = z.object({ id: z.string().uuid(), documentId: z.string().uuid() });

export const createKnowledgeBaseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional(),
});

export const prepareKnowledgeDocumentSchema = z.object({
  filename: z.string().trim().min(1).max(240),
  contentType: z.enum(contentTypes),
  size: z.number().int().positive().max(15 * 1024 * 1024),
});

export const queryKnowledgeBaseSchema = z.object({
  query: z.string().trim().min(1).max(4_000),
  mode: z.enum(['hybrid', 'naive', 'local', 'global', 'mix']).default('hybrid'),
  topK: z.number().int().min(1).max(20).default(5),
  enableRerank: z.boolean().default(true),
});

export type CreateKnowledgeBaseInput = z.infer<typeof createKnowledgeBaseSchema>;
export type PrepareKnowledgeDocumentInput = z.infer<typeof prepareKnowledgeDocumentSchema>;
export type QueryKnowledgeBaseInput = z.infer<typeof queryKnowledgeBaseSchema>;
