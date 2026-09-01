import { randomUUID } from 'node:crypto';

import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildApi } from '../../src/app';
import { loadConfig } from '../../src/config';
import { closeDb, getDb } from '../../src/db/client';
import { authUsers } from '../../src/db/schema';

describe('knowledge base asynchronous indexing HTTP boundary', () => {
  const suffix = randomUUID();
  const email = `rag-http-${suffix}@chalk.local`;
  const password = `password-${suffix}`;
  let app: Awaited<ReturnType<typeof buildApi>>;
  let userId: string;
  let cookie: string;
  let knowledgeBaseId: string;
  let gate: Promise<void> | undefined;
  let releaseGate: (() => void) | undefined;
  let indexMode: 'success' | 'fail' = 'success';
  let lastFileKey: string | undefined;
  const deletedDocumentIds: string[] = [];
  const objects = new Map<string, { content: Buffer; contentType: string }>();

  const objectStorage = {
    publicUrl: () => undefined,
    createUploadUrl: async ({ fileKey }: { fileKey: string }) => {
      lastFileKey = fileKey;
      return 'https://uploads.example.test/signed';
    },
    inspectObject: async (fileKey: string) => {
      const object = objects.get(fileKey);
      if (!object) throw new Error('object missing');
      return { size: object.content.length, contentType: object.contentType };
    },
    readObject: async (fileKey: string) => {
      const object = objects.get(fileKey);
      if (!object) throw new Error('object missing');
      return object.content;
    },
  };

  const ragSidecarClient = {
    async indexDocument(input: { documentId: string }) {
      if (gate) await gate;
      if (indexMode === 'fail') throw new Error('sidecar unavailable');
      return { documentId: input.documentId, status: 'ready' as const, chunkCount: 2, pageCount: 1 };
    },
    async query() {
      return {
        answer: 'ok',
        references: [],
        metadata: { provider: 'test', mode: 'hybrid', reranked: false, latencyMs: 0 },
      };
    },
    async chunks() {
      return { chunks: [] };
    },
    async deleteDocument(input: { documentId: string }) {
      deletedDocumentIds.push(input.documentId);
      return undefined;
    },
  };

  function responseCookie(value: string | string[] | undefined) {
    const first = Array.isArray(value) ? value[0] : value;
    return first?.split(';', 1)[0] ?? '';
  }

  async function createAndConfirm(filename: string) {
    const content = Buffer.from(`# ${filename}\n等式两边同时加 1。`);
    const presign = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBaseId}/documents/presign`,
      headers: { cookie },
      payload: { filename, contentType: 'text/markdown', size: content.length },
    });
    expect(presign.statusCode).toBe(200);
    const reserved = presign.json() as { document: { id: string } };
    expect(lastFileKey).toBeTruthy();
    objects.set(lastFileKey!, { content, contentType: 'text/markdown' });

    const confirmed = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBaseId}/documents/${reserved.document.id}/confirm`,
      headers: { cookie },
    });
    return { confirmed, documentId: reserved.document.id };
  }

  async function document(documentId: string) {
    const response = await app.inject({
      method: 'GET',
      url: `/knowledge-bases/${knowledgeBaseId}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    const documents = response.json().knowledgeBase.documents as Array<{ id: string; status: string; error: string | null; chunkCount: number | null }>;
    return documents.find((item) => item.id === documentId)!;
  }

  beforeAll(async () => {
    const rows = await getDb().insert(authUsers).values({
      email,
      passwordHash: await hash(password, 4),
      role: 'user',
      name: 'RAG HTTP 用户',
    }).returning({ id: authUsers.id });
    userId = rows[0]!.id;
    app = await buildApi({
      config: loadConfig({ NODE_ENV: 'test', SESSION_COOKIE_NAME: `rag_http_${suffix}` }),
      knowledgeObjectStorage: objectStorage,
      ragSidecarClient,
    });
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });
    expect(login.statusCode).toBe(200);
    cookie = responseCookie(login.headers['set-cookie']);
    const created = await app.inject({
      method: 'POST',
      url: '/knowledge-bases',
      headers: { cookie },
      payload: { name: '异步索引测试' },
    });
    expect(created.statusCode).toBe(201);
    knowledgeBaseId = created.json().knowledgeBase.id as string;
  });

  afterAll(async () => {
    releaseGate?.();
    await app?.close();
    if (userId) await getDb().delete(authUsers).where(eq(authUsers.id, userId));
    await closeDb();
  });

  it('returns 202 and completes indexing asynchronously', async () => {
    let resolveGate!: () => void;
    gate = new Promise<void>((resolve) => { resolveGate = resolve; });
    releaseGate = resolveGate;
    indexMode = 'success';

    const { confirmed, documentId } = await createAndConfirm('async.md');
    expect(confirmed.statusCode).toBe(202);
    expect(['pending', 'indexing']).toContain(confirmed.json().document.status);

    resolveGate();
    gate = undefined;
    releaseGate = undefined;
    await vi.waitFor(async () => expect((await document(documentId)).status).toBe('ready'));
    expect(await document(documentId)).toMatchObject({ status: 'ready', chunkCount: 2 });
  });

  it('persists failures and allows a failed document to be retried', async () => {
    indexMode = 'fail';
    const { confirmed, documentId } = await createAndConfirm('retry.md');
    expect(confirmed.statusCode).toBe(202);
    await vi.waitFor(async () => expect((await document(documentId)).status).toBe('failed'));
    expect(await document(documentId)).toMatchObject({ status: 'failed', error: 'RAG_INDEX_FAILED' });

    indexMode = 'success';
    const retry = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/confirm`,
      headers: { cookie },
    });
    expect(retry.statusCode).toBe(202);
    await vi.waitFor(async () => expect((await document(documentId)).status).toBe('ready'));
  });

  it('removes the old index and reindexes a ready document', async () => {
    indexMode = 'success';
    const { documentId } = await createAndConfirm('reindex.md');
    await vi.waitFor(async () => expect((await document(documentId)).status).toBe('ready'));

    const response = await app.inject({
      method: 'POST',
      url: `/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/reindex`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(202);
    expect(deletedDocumentIds).toContain(documentId);
    await vi.waitFor(async () => expect((await document(documentId)).status).toBe('ready'));
  });
});
