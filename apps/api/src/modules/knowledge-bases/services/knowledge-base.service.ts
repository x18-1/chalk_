import { randomUUID } from 'node:crypto';

import type { Database } from '../../../db/client';
import { createKnowledgeBasesDal, createKnowledgeDocumentsDal } from '../../../db/dal';
import { ApiError } from '../../../http/errors';
import type { PrepareKnowledgeDocumentInput, QueryKnowledgeBaseInput, CreateKnowledgeBaseInput } from '../schemas';
import type { RagSidecarClient } from '../rag-sidecar-client';

const safeIndexErrorCodes = new Set([
  'RAG_SIDECAR_ERROR',
  'RAG_INVALID_RESPONSE',
  'RAG_SIDECAR_TIMEOUT',
  'RAG_SIDECAR_UNAVAILABLE',
  'RAG_INDEX_FAILED',
]);

export type KnowledgeObjectStorage = {
  publicUrl(fileKey: string): string | undefined;
  createUploadUrl(input: { fileKey: string; contentType: string; size: number }): Promise<string>;
  inspectObject(fileKey: string): Promise<{ size?: number; contentType?: string }>;
  readObject(fileKey: string): Promise<Buffer>;
};

type IndexJob = {
  userId: string;
  knowledgeBaseId: string;
  documentId: string;
};

export class LocalIndexQueue {
  private readonly jobs: IndexJob[] = [];
  private readonly queued = new Set<string>();
  private draining = false;
  private stopped = false;

  constructor(private readonly process: (job: IndexJob) => Promise<void>) {}

  enqueue(job: IndexJob) {
    if (this.stopped) throw new Error('Knowledge base index worker is stopped');
    if (this.queued.has(job.documentId)) return;
    this.jobs.push(job);
    this.queued.add(job.documentId);
    void this.drain();
  }

  stop() {
    this.stopped = true;
    this.jobs.length = 0;
    this.queued.clear();
  }

  private async drain() {
    if (this.draining) return;
    this.draining = true;
    try {
      while (!this.stopped && this.jobs.length > 0) {
        const job = this.jobs.shift()!;
        try {
          await this.process(job);
        } catch {
          // The processor persists the failed state. Keep the worker alive for
          // subsequent documents instead of poisoning the queue.
        } finally {
          this.queued.delete(job.documentId);
        }
      }
    } finally {
      this.draining = false;
      if (!this.stopped && this.jobs.length > 0) void this.drain();
    }
  }
}

export class KnowledgeBaseService {
  private readonly bases;
  private readonly documents;
  private readonly indexQueue: LocalIndexQueue;

  constructor(
    db: Database,
    private readonly objectStorage: KnowledgeObjectStorage,
    private readonly rag: RagSidecarClient,
  ) {
    this.bases = createKnowledgeBasesDal(db);
    this.documents = createKnowledgeDocumentsDal(db);
    this.indexQueue = new LocalIndexQueue((job) => this.processIndexJob(job));
  }

  stopWorker() {
    this.indexQueue.stop();
  }

  async list(userId: string) {
    const bases = await this.bases.list(userId);
    return Promise.all(bases.map(async (base) => ({
      ...this.publicBase(base),
      documents: (await this.documents.listForKnowledgeBase(userId, base.id)).map((document) => this.publicDocument(document)),
    })));
  }

  async get(userId: string, id: string) {
    const base = await this.bases.getById(userId, id);
    return { ...this.publicBase(base), documents: (await this.documents.listForKnowledgeBase(userId, id)).map((document) => this.publicDocument(document)) };
  }

  create(userId: string, input: CreateKnowledgeBaseInput) {
    return this.bases.create(userId, input).then((base) => ({ ...this.publicBase(base), documents: [] }));
  }

  async prepareDocument(userId: string, knowledgeBaseId: string, input: PrepareKnowledgeDocumentInput) {
    await this.bases.getById(userId, knowledgeBaseId);
    const safeFilename = input.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const fileKey = [userId, 'knowledge-bases', knowledgeBaseId, `${randomUUID()}-${safeFilename}`].join('/');
    const document = await this.documents.create(userId, { knowledgeBaseId, ...input, fileKey });
    let uploadUrl: string;
    try {
      uploadUrl = await this.objectStorage.createUploadUrl({ fileKey, contentType: input.contentType, size: input.size });
    } catch {
      throw new ApiError(502, 'Upload service is temporarily unavailable', 'UPLOAD_PRESIGN_FAILED');
    }
    return { document: this.publicDocument(document), uploadUrl, expiresIn: 600 };
  }

  async confirmDocument(userId: string, knowledgeBaseId: string, documentId: string, options?: { reindex?: boolean }) {
    const document = await this.documents.getById(userId, documentId);
    if (document.knowledgeBaseId !== knowledgeBaseId) throw new ApiError(404, 'Knowledge document not found', 'NOT_FOUND');
    let object: Awaited<ReturnType<KnowledgeObjectStorage['inspectObject']>>;
    try {
      object = await this.objectStorage.inspectObject(document.fileKey);
    } catch {
      throw new ApiError(502, 'Uploaded file could not be verified', 'UPLOAD_VERIFICATION_FAILED');
    }
    if (object.size !== undefined && object.size !== document.size) throw new ApiError(400, 'Uploaded file size does not match the reservation', 'UPLOAD_SIZE_MISMATCH');
    if (object.contentType) {
      const actualContentType = object.contentType.split(';', 1)[0]!.trim().toLowerCase();
      if (actualContentType !== document.contentType.toLowerCase()) {
        throw new ApiError(400, 'Uploaded file type does not match the reservation', 'UPLOAD_CONTENT_TYPE_MISMATCH');
      }
    }
    if (document.status === 'indexing' || document.status === 'pending') return this.publicDocument(document);
    if (document.status === 'ready' && !options?.reindex) return this.publicDocument(document);
    if (document.status === 'ready' && options?.reindex) {
      try {
        await this.rag.deleteDocument({ knowledgeBaseId, documentId });
      } catch {
        throw new ApiError(502, 'Existing index could not be removed', 'RAG_REINDEX_FAILED');
      }
    }
    await this.documents.updateStatus(userId, documentId, { status: 'pending', error: null });
    this.indexQueue.enqueue({ userId, knowledgeBaseId, documentId });
    const queued = await this.documents.getById(userId, documentId);
    return this.publicDocument(queued);
  }

  private async processIndexJob(job: IndexJob) {
    const document = await this.documents.getById(job.userId, job.documentId);
    if (document.knowledgeBaseId !== job.knowledgeBaseId || document.status === 'ready') return;
    await this.documents.updateStatus(job.userId, job.documentId, { status: 'indexing', error: null });
    try {
      const result = await this.rag.indexDocument({
        knowledgeBaseId: job.knowledgeBaseId,
        documentId: job.documentId,
        filename: document.filename,
        contentType: document.contentType,
        content: await this.objectStorage.readObject(document.fileKey),
      });
      await this.documents.updateStatus(job.userId, job.documentId, {
        status: 'ready',
        chunkCount: result.chunkCount,
        pageCount: result.pageCount,
        indexedAt: new Date(),
      });
    } catch (error) {
      const safeCode = error instanceof ApiError && safeIndexErrorCodes.has(error.code)
        ? error.code
        : 'RAG_INDEX_FAILED';
      await this.documents.updateStatus(job.userId, job.documentId, {
        status: 'failed',
        error: safeCode,
      });
    }
  }

  async query(userId: string, knowledgeBaseId: string, input: QueryKnowledgeBaseInput) {
    await this.bases.getById(userId, knowledgeBaseId);
    const documents = await this.documents.listForKnowledgeBase(userId, knowledgeBaseId);
    if (!documents.some((document) => document.status === 'ready')) {
      throw new ApiError(409, 'Upload and index at least one document before querying', 'RAG_KB_NOT_READY');
    }
    return this.rag.query({ knowledgeBaseId, ...input });
  }

  async chunks(userId: string, knowledgeBaseId: string, documentId: string) {
    const document = await this.documents.getById(userId, documentId);
    if (document.knowledgeBaseId !== knowledgeBaseId) throw new ApiError(404, 'Knowledge document not found', 'NOT_FOUND');
    if (document.status !== 'ready') throw new ApiError(409, 'Document indexing is not complete', 'RAG_DOCUMENT_NOT_READY');
    return this.rag.chunks({ knowledgeBaseId, documentId });
  }

  private publicBase(base: { id: string; name: string; description: string | null; createdAt: Date; updatedAt: Date }) {
    return {
      id: base.id,
      name: base.name,
      description: base.description,
      createdAt: base.createdAt,
      updatedAt: base.updatedAt,
    };
  }

  private publicDocument(document: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    status: string;
    error: string | null;
    chunkCount: number | null;
    pageCount: number | null;
    createdAt: Date;
    indexedAt: Date | null;
  }) {
    return {
      id: document.id,
      filename: document.filename,
      contentType: document.contentType,
      size: document.size,
      status: document.status,
      error: document.error && safeIndexErrorCodes.has(document.error)
        ? document.error
        : document.error ? 'RAG_INDEX_FAILED' : null,
      chunkCount: document.chunkCount,
      pageCount: document.pageCount,
      createdAt: document.createdAt,
      indexedAt: document.indexedAt,
    };
  }
}
