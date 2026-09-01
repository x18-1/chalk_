import { describe, expect, it, vi } from 'vitest';

import { createBuiltinToolRegistry } from '../../src/agent/builtin-tools';

describe('Chalk built-in tools', () => {
  it('does not register a placeholder search tool without a provider', () => {
    const registry = createBuiltinToolRegistry({
      conversationTitleUpdater: { update: vi.fn() },
    });

    expect(registry.list().map((tool) => tool.name)).not.toContain('search_learning_resources');
    expect(registry.list().map((tool) => tool.name)).not.toContain('search_knowledge_base');
    expect(registry.list().map((tool) => tool.name)).not.toContain('read_resource');
  });

  it('registers Read only when an owned-file reader and cursor secret are supplied', () => {
    const registry = createBuiltinToolRegistry({
      conversationTitleUpdater: { update: vi.fn() },
      readResourceReader: { read: vi.fn() },
      readCursorSecret: 'test-secret',
    });

    expect(registry.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'read_resource', effects: ['read', 'network'], defaultEnabled: true }),
    ]));
  });

  it('searches through an injected provider and bounds untrusted results', async () => {
    const search = vi.fn(async () => [
      {
        title: '  Triangle congruence  ',
        url: 'https://example.test/triangle',
        snippet: '  Compare the known sides and angles. '.repeat(30),
      },
      {
        title: 'Invalid result',
        url: 'javascript:alert(1)',
        snippet: 'This must not reach the model.',
      },
    ]);
    const registry = createBuiltinToolRegistry({
      searchProvider: { search },
      conversationTitleUpdater: { update: vi.fn() },
    });
    const tool = registry.createAgentTools({
      context: { ownerId: 'student-1', sessionId: 'session-1' },
    }).find((candidate) => candidate.name === 'search_learning_resources');

    const result = await tool!.execute(
      'search-1',
      { query: 'triangle', limit: 4 },
      undefined,
    );

    expect(search).toHaveBeenCalledWith(expect.objectContaining({ query: 'triangle', limit: 4 }));
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(JSON.stringify(result)).toContain('https://example.test/triangle');
    expect(JSON.stringify(result)).not.toContain('javascript:');
    expect(JSON.stringify(result)).not.toContain('Compare the known sides and angles. '.repeat(30));
  });

  it('requires approval before changing the current conversation title', async () => {
    const update = vi.fn(async ({ title }: { title: string }) => ({ title }));
    const approval = vi.fn(async () => ({ approved: true }));
    const registry = createBuiltinToolRegistry({
      conversationTitleUpdater: { update },
    });
    const tool = registry.createAgentTools({
      context: {
        ownerId: 'student-1',
        sessionId: 'session-1',
        conversationId: 'conversation-1',
      },
      approval: { request: approval },
    }).find((candidate) => candidate.name === 'rename_current_conversation');

    await tool!.execute('rename-1', { title: '相似三角形复习' }, undefined);

    expect(approval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'rename-1',
        toolName: 'rename_current_conversation',
        args: { title: '相似三角形复习' },
      }),
      undefined,
      expect.any(Function),
    );
    expect(update).toHaveBeenCalledWith({
      ownerId: 'student-1',
      conversationId: 'conversation-1',
      title: '相似三角形复习',
    });
  });

  it('fails closed when the approval port is missing', async () => {
    const update = vi.fn();
    const registry = createBuiltinToolRegistry({
      conversationTitleUpdater: { update },
    });
    const tool = registry.createAgentTools({
      context: {
        ownerId: 'student-1',
        sessionId: 'session-1',
        conversationId: 'conversation-1',
      },
    }).find((candidate) => candidate.name === 'rename_current_conversation');

    await expect(tool!.execute('rename-2', { title: '不应执行' }, undefined))
      .rejects.toThrow('requires approval');
    expect(update).not.toHaveBeenCalled();
  });

  it('registers knowledge-base search with the selected base bound outside model arguments', async () => {
    const query = vi.fn(async () => ({
      answer: '相似三角形的对应角相等。',
      references: [{
        citationId: 'cite-1', documentId: 'doc-1', documentName: '数学讲义.md', chunkId: 'chunk-1',
        snippet: '对应角相等。', page: 3,
      }],
      metadata: { provider: 'lightrag', mode: 'hybrid', reranked: true, latencyMs: 12 },
    }));
    const registry = createBuiltinToolRegistry({
      conversationTitleUpdater: { update: vi.fn() },
      knowledgeBaseQueryer: { query },
      knowledgeBaseId: '00000000-0000-0000-0000-000000000001',
      ownerId: 'student-1',
    });
    const tool = registry.createAgentTools({ context: { ownerId: 'student-1', sessionId: 'session-1' } })
      .find((candidate) => candidate.name === 'search_knowledge_base');

    await tool!.execute('rag-1', { query: '对应角', topK: 3 }, undefined);

    expect(query).toHaveBeenCalledWith(
      'student-1',
      '00000000-0000-0000-0000-000000000001',
      { query: '对应角', mode: 'hybrid', topK: 3, enableRerank: true },
    );
  });
});
