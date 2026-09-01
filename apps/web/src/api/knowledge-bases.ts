import { apiJson, ApiRequestError } from './client';

export type KnowledgeDocument = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  status: 'pending' | 'indexing' | 'ready' | 'failed';
  error: string | null;
  chunkCount: number | null;
  pageCount: number | null;
  createdAt: string;
  indexedAt: string | null;
};
export type KnowledgeChunk = {
  chunkId: string;
  index: number;
  content: string;
  tokenCount: number;
  page?: number;
  paragraph?: number;
};

export type KnowledgeBase = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  documents: KnowledgeDocument[];
};

export type RagReference = {
  citationId: string;
  documentId: string;
  documentName: string;
  chunkId: string;
  snippet: string;
  score?: number;
  page?: number;
  paragraph?: number;
};

export type RagAnswer = {
  answer: string;
  references: RagReference[];
  metadata: { provider: string; mode: string; reranked: boolean; latencyMs: number };
};

export const knowledgeBasesApi = {
  list(signal?: AbortSignal) {
    return apiJson<{ knowledgeBases: KnowledgeBase[] }>('/knowledge-bases', { signal });
  },
  create(input: { name: string; description?: string }) {
    return apiJson<{ knowledgeBase: KnowledgeBase }>('/knowledge-bases', {
      method: 'POST', body: JSON.stringify(input),
    });
  },
  prepareDocument(knowledgeBaseId: string, input: { filename: string; contentType: string; size: number }) {
    return apiJson<{ document: KnowledgeDocument; uploadUrl: string; expiresIn: number }>(`/knowledge-bases/${knowledgeBaseId}/documents/presign`, {
      method: 'POST', body: JSON.stringify(input),
    });
  },
  confirmDocument(knowledgeBaseId: string, documentId: string) {
    return apiJson<{ document: KnowledgeDocument }>(`/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/confirm`, {
      method: 'POST', body: JSON.stringify({}),
    });
  },
  reindexDocument(knowledgeBaseId: string, documentId: string) {
    return apiJson<{ document: KnowledgeDocument }>(`/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/reindex`, {
      method: 'POST', body: JSON.stringify({}),
    });
  },
  query(knowledgeBaseId: string, input: { query: string; mode?: string; topK?: number; enableRerank?: boolean }) {
    return apiJson<RagAnswer>(`/knowledge-bases/${knowledgeBaseId}/query`, {
      method: 'POST', body: JSON.stringify(input),
    });
  },
  chunks(knowledgeBaseId: string, documentId: string) {
    return apiJson<{ chunks: KnowledgeChunk[] }>(`/knowledge-bases/${knowledgeBaseId}/documents/${documentId}/chunks`);
  },
};

export function knowledgeBaseErrorMessage(error: unknown) {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return '登录状态已失效，请重新登录。';
    if (error.status === 404) return '知识库不存在或你没有访问权限。';
    if (error.code === 'RAG_SIDECAR_TIMEOUT') return '检索耗时过长，请稍后重试。';
    if (error.code === 'RAG_SIDECAR_UNAVAILABLE') return '检索服务暂时不可用，请稍后重试。';
    if (error.code === 'RAG_KB_NOT_READY') return '请先上传并完成至少一份资料的索引。';
    if (error.code === 'UPLOAD_CONTENT_TYPE_MISMATCH') return '上传文件类型与声明不一致。';
    if (error.code === 'UPLOAD_SIZE_MISMATCH') return '上传文件大小与声明不一致。';
    if (error.code === 'UPLOAD_PRESIGN_FAILED') return '无法生成上传地址，请确认对象存储服务正在运行。';
    if (error.code === 'UPLOAD_VERIFICATION_FAILED') return '上传完成但服务器无法验证文件，请重试。';
    if (error.code === 'INVALID_REQUEST') return '文件信息无效：请确认格式受支持且文件不超过 15 MB。';
    if (error.code === 'RAG_INDEX_FAILED') return '资料索引失败，请检查文件后重试。';
    if (error.code === 'RAG_REINDEX_FAILED') return '旧索引清理失败，请稍后重试。';
  }
  return error instanceof Error ? error.message : '知识库操作失败，请稍后重试。';
}
