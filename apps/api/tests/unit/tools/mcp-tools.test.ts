import { describe, expect, it } from 'vitest';

import { createMcpTools } from '../../../src/agent/tools/mcp-tool/mcp-tools';

describe('MCP Tool composition', () => {
  const proxy = { name: 'mcp__fixture__fixture' };
  const manager = { proxyTools: () => [proxy] } as never;
  const reader = { read: async () => { throw new Error('not used'); } };

  it('keeps MCP Resources out of the product-facing v1 surface by default', () => {
    expect(createMcpTools({ manager, resourceReader: reader, cursorSecret: 'secret' }))
      .toEqual([proxy]);
  });

  it('can still compose the isolated Resource fixture explicitly', () => {
    expect(createMcpTools({
      manager,
      resourceReader: reader,
      cursorSecret: 'secret',
      enableResources: true,
    }).map((tool) => tool.name)).toEqual([
      'mcp__fixture__fixture',
      'read_mcp_resource',
    ]);
  });
});
