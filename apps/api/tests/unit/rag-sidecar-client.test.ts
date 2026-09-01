import { describe, expect, it, vi } from 'vitest';

import { createRagSidecarClient } from '../../src/modules/knowledge-bases/rag-sidecar-client';

describe('RAG sidecar client', () => {
  it('sends the internal bearer token and validates a query envelope', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({
      answer: '一次函数的图像是一条直线。',
      references: [{ citationId: 'cite-1', documentId: 'doc-1', documentName: 'notes.md', chunkId: 'chunk-1', snippet: '一次函数的图像是一条直线。', page: 2 }],
      metadata: { provider: 'lightrag-hku@1.5.7rc2', mode: 'hybrid', reranked: true, latencyMs: 12 },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createRagSidecarClient({ baseUrl: 'http://rag.test/', token: 'secret', timeoutMs: 1000, fetch });

    await expect(client.query({ knowledgeBaseId: 'kb-1', query: '什么是一次函数？', mode: 'hybrid', topK: 5, enableRerank: true })).resolves.toMatchObject({ answer: '一次函数的图像是一条直线。' });
    expect(fetch).toHaveBeenCalledWith('http://rag.test/v1/query', expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer secret' }) }));
  });

  it('fails closed when the sidecar is unavailable', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new TypeError('connect refused'));
    const client = createRagSidecarClient({ baseUrl: 'http://rag.test', token: 'secret', timeoutMs: 1000, fetch });

    await expect(client.query({ knowledgeBaseId: 'kb-1', query: 'test', mode: 'hybrid', topK: 5, enableRerank: true })).rejects.toMatchObject({ statusCode: 503, code: 'RAG_SIDECAR_UNAVAILABLE' });
  });

  it('rejects malformed envelopes instead of passing them to the UI', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({ answer: 'missing refs' }), { status: 200 }));
    const client = createRagSidecarClient({ baseUrl: 'http://rag.test', token: 'secret', timeoutMs: 1000, fetch });

    await expect(client.query({ knowledgeBaseId: 'kb-1', query: 'test', mode: 'hybrid', topK: 5, enableRerank: true })).rejects.toMatchObject({ statusCode: 502, code: 'RAG_INVALID_RESPONSE' });
  });
});
