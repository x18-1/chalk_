import { describe, expect, it, vi } from 'vitest';
import { validateToolArguments } from '@earendil-works/pi-ai';

import { createBuiltinToolRegistry } from '../../src/agent/builtin-tools';

describe('Chalk built-in tools', () => {
  it('does not register a placeholder search tool without a provider', () => {
    const registry = createBuiltinToolRegistry({
      conversationTitleUpdater: { update: vi.fn() },
    });

    expect(registry.list().map((tool) => tool.name)).not.toContain('search_learning_resources');
    expect(registry.list().map((tool) => tool.name)).not.toContain('read_resource');
  });

  it('registers a content-only Chalkboard renderer by default', async () => {
    const registry = createBuiltinToolRegistry({
      conversationTitleUpdater: { update: vi.fn() },
    });
    const tool = registry.createAgentTools({
      context: { ownerId: 'student-1', sessionId: 'session-1' },
    }).find((candidate) => candidate.name === 'render_chalkboard');

    expect(tool).toMatchObject({ name: 'render_chalkboard' });
    const result = await tool!.execute('render-1', {
      title: '函数图像',
      content: { type: 'slide', canvas: { elements: [{ type: 'text', content: 'y = x' }] } },
    }, undefined);

    expect(result.content).toEqual([{ type: 'text', text: '已插入只读 slide Scene「函数图像」。Chat 仅展示内容，不执行 Action、互动操作或 Quiz 提交。' }]);
    expect(result.details).toMatchObject({ type: 'scene', scene: { title: '函数图像', type: 'slide' } });
  });

  it('accepts the coordinate and text fields used by existing Chalkboard scenes', async () => {
    const registry = createBuiltinToolRegistry({
      conversationTitleUpdater: { update: vi.fn() },
    });
    const tool = registry.createAgentTools({
      context: { ownerId: 'student-1', sessionId: 'session-1' },
    }).find((candidate) => candidate.name === 'render_chalkboard');

    const result = await tool!.execute('render-compat-1', {
      title: '加减法基础',
      content: {
        type: 'slide',
        canvas: {
          elements: [
            { id: 'heading', type: 'text', x: 240, y: 40, text: '加法 · 合在一起', fontSize: 34 },
            { id: 'divider', type: 'line', x1: 60, y1: 230, x2: 300, y2: 230, stroke: '#7d9b7f', strokeWidth: 2 },
          ],
        },
      },
    }, undefined);

    expect(result.details).toMatchObject({
      type: 'scene',
      scene: {
        content: {
          canvas: {
            elements: [
              { id: 'heading', type: 'text', left: 240, top: 40, content: '加法 · 合在一起' },
              { id: 'divider', type: 'line', start: [60, 230], end: [300, 230], color: '#7d9b7f', width: 2 },
            ],
          },
        },
      },
    });
  });

  it('accepts CSS background colors and canonicalizes them before validation', () => {
    const registry = createBuiltinToolRegistry({
      conversationTitleUpdater: { update: vi.fn() },
    });
    const tool = registry.createAgentTools({
      context: { ownerId: 'student-1', sessionId: 'session-1' },
    }).find((candidate) => candidate.name === 'render_chalkboard')!;
    const rawCall = {
      type: 'toolCall' as const,
      id: 'render-background-1',
      name: 'render_chalkboard',
      arguments: {
        title: '将军饮马问题',
        content: {
          type: 'slide',
          canvas: { background: '#ffffff', elements: [] },
        },
      },
    };

    const prepared = tool.prepareArguments!(rawCall.arguments);
    expect(prepared).toMatchObject({ content: { canvas: { background: { color: '#ffffff' } } } });
    expect(validateToolArguments(tool, { ...rawCall, arguments: prepared as Record<string, unknown> })).toEqual(prepared);
  });

  it('rejects Chat-only scene types and unsupported interactive payloads at the tool schema', () => {
    const registry = createBuiltinToolRegistry({
      conversationTitleUpdater: { update: vi.fn() },
    });
    const tool = registry.createAgentTools({
      context: { ownerId: 'student-1', sessionId: 'session-1' },
    }).find((candidate) => candidate.name === 'render_chalkboard')!;

    expect(() => validateToolArguments(tool, {
      type: 'toolCall',
      id: 'render-pbl-1',
      name: 'render_chalkboard',
      arguments: { content: { type: 'pbl', projectConfig: {} } },
    })).toThrow(/content\.type/);
    expect(() => validateToolArguments(tool, {
      type: 'toolCall',
      id: 'render-interactive-1',
      name: 'render_chalkboard',
      arguments: { content: { type: 'interactive' } },
    })).toThrow(/content/);
  });

  it('normalizes point and circle aliases into renderer-supported shapes', async () => {
    const registry = createBuiltinToolRegistry({
      conversationTitleUpdater: { update: vi.fn() },
    });
    const tool = registry.createAgentTools({
      context: { ownerId: 'student-1', sessionId: 'session-1' },
    }).find((candidate) => candidate.name === 'render_chalkboard')!;
    const result = await tool.execute('render-shapes-1', {
      title: '几何点',
      content: {
        type: 'slide',
        canvas: {
          elements: [
            { type: 'point', x: 100, y: 120, color: '#e74c3c' },
            { type: 'circle', cx: 220, cy: 120, r: 12, fill: '#2f80ed' },
          ],
        },
      },
    }, undefined);

    expect(result.details).toMatchObject({
      scene: {
        content: {
          canvas: {
            elements: [
              { type: 'shape', left: 94, top: 114, width: 12, height: 12 },
              { type: 'shape', left: 208, top: 108, width: 24, height: 24 },
            ],
          },
        },
      },
    });
  });

  it('recovers a slide discriminator omitted by a model retry', async () => {
    const registry = createBuiltinToolRegistry({
      conversationTitleUpdater: { update: vi.fn() },
    });
    const tool = registry.createAgentTools({
      context: { ownerId: 'student-1', sessionId: 'session-1' },
    }).find((candidate) => candidate.name === 'render_chalkboard');

    const retryArgs = tool!.prepareArguments!({
      title: '加减法基础',
      content: { canvas: { elements: [{ type: 'text', text: '3 + 2 = 5' }] } },
    });
    const result = await tool!.execute('render-retry-1', retryArgs, undefined);

    expect(result.details).toMatchObject({
      type: 'scene',
      scene: { type: 'slide', content: { type: 'slide' } },
    });
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
});
