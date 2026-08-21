import { describe, expect, it, vi } from 'vitest';

import { createBuiltinToolRegistry } from '../../src/agent/builtin-tools';

describe('Chalk built-in tools', () => {
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
});
