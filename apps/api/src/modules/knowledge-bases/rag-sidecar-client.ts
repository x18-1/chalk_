import { z } from 'zod';

import { ApiError } from '../../http/errors';
import {
  ragIndexResponseSchema,
  ragQueryResponseSchema,
  ragChunksResponseSchema,
  type RagIndexResponse,
  type RagQueryResponse,
  type RagChunksResponse,
} from './protocol';

export type { RagIndexResponse, RagQueryResponse } from './protocol';
export type { RagChunksResponse } from './protocol';

export type RagSidecarClient = {
  indexDocument(input: {
    knowledgeBaseId: string;
    documentId: string;
    filename: string;
    contentType: string;
    content: Buffer;
  }): Promise<RagIndexResponse>;
  query(input: {
    knowledgeBaseId: string;
    query: string;
    mode: string;
    topK: number;
    enableRerank: boolean;
  }): Promise<RagQueryResponse>;
  chunks(input: { knowledgeBaseId: string; documentId: string }): Promise<RagChunksResponse>;
  deleteDocument(input: { knowledgeBaseId: string; documentId: string }): Promise<void>;
};

export function createRagSidecarClient(options: {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}): RagSidecarClient {
  const request = options.fetch ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, '');

  async function call<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await request(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.token}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new ApiError(502, 'RAG sidecar rejected the request', 'RAG_SIDECAR_ERROR');
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        throw new ApiError(502, 'RAG sidecar returned an invalid response', 'RAG_INVALID_RESPONSE');
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const code = error instanceof Error && error.name === 'AbortError'
        ? 'RAG_SIDECAR_TIMEOUT'
        : 'RAG_SIDECAR_UNAVAILABLE';
      throw new ApiError(503, code === 'RAG_SIDECAR_TIMEOUT' ? 'RAG query timed out' : 'RAG service is temporarily unavailable', code);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    indexDocument(input) {
      return call('/v1/index', {
        knowledgeBaseId: input.knowledgeBaseId,
        documentId: input.documentId,
        filename: input.filename,
        contentType: input.contentType,
        contentBase64: input.content.toString('base64'),
      }, ragIndexResponseSchema);
    },
    query(input) {
      return call('/v1/query', input, ragQueryResponseSchema);
    },
    chunks(input) {
      return call('/v1/chunks', input, ragChunksResponseSchema);
    },
    async deleteDocument(input) {
      await call('/v1/delete', input, z.object({ status: z.literal('deleted') }));
    },
  };
}
