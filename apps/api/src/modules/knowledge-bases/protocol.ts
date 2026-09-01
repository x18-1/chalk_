import { z } from 'zod';

export const ragReferenceSchema = z.object({
  citationId: z.string().min(1),
  documentId: z.string().min(1),
  documentName: z.string().min(1),
  chunkId: z.string().min(1),
  snippet: z.string(),
  score: z.number().optional(),
  page: z.number().int().positive().optional(),
  paragraph: z.number().int().positive().optional(),
});

export const ragQueryRequestSchema = z.object({
  knowledgeBaseId: z.string().uuid(),
  query: z.string().trim().min(1).max(4_000),
  mode: z.enum(['hybrid', 'naive', 'local', 'global', 'mix']),
  topK: z.number().int().min(1).max(20),
  enableRerank: z.boolean(),
});

export const ragQueryResponseSchema = z.object({
  answer: z.string(),
  references: z.array(ragReferenceSchema),
  metadata: z.object({
    provider: z.string(),
    mode: z.string(),
    reranked: z.boolean(),
    latencyMs: z.number().nonnegative(),
  }),
});

export const ragIndexRequestSchema = z.object({
  knowledgeBaseId: z.string().uuid(),
  documentId: z.string().uuid(),
  filename: z.string().min(1).max(240),
  contentType: z.enum([
    'text/plain',
    'text/markdown',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]),
  contentBase64: z.string().min(1),
});

export const ragIndexResponseSchema = z.object({
  documentId: z.string().uuid(),
  status: z.literal('ready'),
  chunkCount: z.number().int().nonnegative(),
  pageCount: z.number().int().nonnegative(),
});

export const ragChunksResponseSchema = z.object({
  chunks: z.array(z.object({
    chunkId: z.string().min(1),
    index: z.number().int().positive(),
    content: z.string(),
    tokenCount: z.number().int().nonnegative(),
    page: z.number().int().positive().optional(),
    paragraph: z.number().int().positive().optional(),
  })),
});

export type RagQueryResponse = z.infer<typeof ragQueryResponseSchema>;
export type RagIndexResponse = z.infer<typeof ragIndexResponseSchema>;
export type RagChunksResponse = z.infer<typeof ragChunksResponseSchema>;
