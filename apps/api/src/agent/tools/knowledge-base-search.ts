import { Type, type Static } from 'typebox';

import type { RuntimeTool, ToolSummary } from '@chalk/agent-runtime';
import type { RagQueryResponse } from '../../modules/knowledge-bases/rag-sidecar-client';

export type KnowledgeBaseQueryer = {
  query(
    userId: string,
    knowledgeBaseId: string,
    input: { query: string; mode: string; topK: number; enableRerank: boolean },
  ): Promise<RagQueryResponse>;
};

const parameters = Type.Object({
  query: Type.String({ minLength: 2, maxLength: 4_000 }),
  topK: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
});

/** Metadata used by the settings catalog. The executable tool is bound to a
 * specific owner and knowledge base when a chat mounts one. */
export const knowledgeBaseSearchToolSummary: ToolSummary = {
  name: 'search_knowledge_base',
  label: '查阅知识库',
  description: '在当前对话挂载的知识库中检索资料，并返回带文档名、页码或段落的引用。',
  source: 'chalk',
  effects: ['read', 'network'],
  approvalPolicy: 'none',
  limits: { timeoutMs: 45_000, maxResultCharacters: 18_000, maxUpdateCharacters: 4_000 },
  defaultEnabled: true,
  executionMode: 'sequential',
  requiresApproval: false,
};

type SearchArguments = Static<typeof parameters>;

function normalizeQuery(value: string) {
  return value.replace(/\s+/g, ' ').trim().slice(0, 4_000);
}

function formatReference(reference: RagQueryResponse['references'][number], index: number) {
  const location = [
    reference.page ? `第 ${reference.page} 页` : undefined,
    reference.paragraph ? `第 ${reference.paragraph} 段` : undefined,
  ].filter(Boolean).join('，');
  return `[${index + 1}] ${reference.documentName}${location ? `（${location}）` : ''}\n${reference.snippet}`;
}

export function createKnowledgeBaseSearchTool(
  queryer: KnowledgeBaseQueryer,
  userId: string,
  knowledgeBaseId: string,
): RuntimeTool<typeof parameters, { type: 'knowledge_base_search'; query: string; references: RagQueryResponse['references']; metadata: RagQueryResponse['metadata'] }> {
  return {
    name: 'search_knowledge_base',
    label: '查阅知识库',
    description:
      '在当前对话挂载的知识库中检索资料。仅用于查找与当前问题相关的文档片段；' +
      '结果会包含资料名称、页码或段落，回答时应说明依据来自哪些资料。',
    parameters,
    source: 'chalk',
    effects: ['read', 'network'],
    approvalPolicy: 'none',
    defaultEnabled: true,
    requiresApproval: false,
    executionMode: 'sequential',
    limits: { timeoutMs: 45_000, maxResultCharacters: 18_000 },
    async execute(args: SearchArguments, _context, signal) {
      if (signal?.aborted) throw new Error('Knowledge base search was aborted');
      const query = normalizeQuery(args.query);
      if (query.length < 2) throw new Error('Knowledge base search query must contain at least 2 characters');
      const result = await queryer.query(userId, knowledgeBaseId, {
        query,
        mode: 'hybrid',
        topK: args.topK ?? 5,
        enableRerank: true,
      });
      const references = result.references.slice(0, args.topK ?? 5);
      const referencesText = references.length
        ? references.map((reference, index) => formatReference(reference, index)).join('\n\n')
        : '没有找到与问题直接匹配的资料片段。';
      return {
        content: [{
          type: 'text',
          text: `知识库检索结果：\n${result.answer}\n\n参考资料：\n${referencesText}`,
        }],
        details: {
          type: 'knowledge_base_search',
          query,
          references,
          metadata: result.metadata,
        },
      };
    },
  };
}
