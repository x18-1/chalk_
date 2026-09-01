import { Type, type Static } from 'typebox';

import type { RuntimeTool } from '@chalk/agent-runtime';

import { SEARCH_LEARNING_RESOURCES_PROMPT } from './prompts';

export type SearchRequest = { query: string; limit: number; signal?: AbortSignal };
export type SearchResult = { title: string; url: string; snippet: string };
export interface SearchProvider { search(request: SearchRequest): Promise<readonly SearchResult[]>; }

const searchParameters = Type.Object({
  query: Type.String({ minLength: 2, maxLength: 200 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 8 })),
});
type SearchArguments = Static<typeof searchParameters>;

function normalized(value: string, maxLength: number) { return value.replace(/\s+/g, ' ').trim().slice(0, maxLength); }
function safeResult(result: SearchResult): SearchResult | undefined {
  const title = normalized(result.title, 200);
  const snippet = normalized(result.snippet, 500);
  let url: URL;
  try { url = new URL(result.url); } catch { return undefined; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
  if (!title || !snippet) return undefined;
  return { title, url: url.toString(), snippet };
}

export function createStaticSearchProvider(resources: readonly SearchResult[]): SearchProvider {
  return { async search({ query, limit, signal }) {
    if (signal?.aborted) throw new Error('Search was aborted');
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return resources.filter((resource) => {
      const haystack = `${resource.title} ${resource.snippet}`.toLowerCase();
      return terms.every((term) => haystack.includes(term));
    }).slice(0, limit);
  } };
}

export function createSearchTool(provider: SearchProvider): RuntimeTool<typeof searchParameters> {
  return {
    name: 'search_learning_resources',
    label: '学习资源搜索',
    description: SEARCH_LEARNING_RESOURCES_PROMPT,
    parameters: searchParameters,
    source: 'chalk',
    effects: ['read', 'network'],
    approvalPolicy: 'none',
    defaultEnabled: true,
    requiresApproval: false,
    executionMode: 'parallel',
    async execute(args: SearchArguments, _context, signal) {
      const query = normalized(args.query, 200);
      if (query.length < 2) throw new Error('Search query must contain at least 2 characters');
      const limit = args.limit ?? 5;
      const candidates = await provider.search({ query, limit, signal });
      const seen = new Set<string>();
      const results = candidates.flatMap((candidate) => {
        const result = safeResult(candidate);
        if (!result || seen.has(result.url)) return [];
        seen.add(result.url);
        return [result];
      }).slice(0, limit);
      const text = results.length === 0 ? '没有找到匹配的学习资源。' : results.map((result, index) => `${index + 1}. ${result.title}\n${result.url}\n${result.snippet}`).join('\n\n');
      return { content: [{ type: 'text', text }], details: { query, count: results.length, results } };
    },
  };
}
