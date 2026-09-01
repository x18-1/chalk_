import { describe, expect, it, vi } from 'vitest';
import { createReadMcpResourceTool } from '../../../src/agent/tools/mcp-tool/read-resource/tool';

describe('read_mcp_resource tool feature', () => {
  it('delegates to the MCP-only reader without a kind discriminator', async () => {
    const read = vi.fn(async () => ({
      filename: 'lesson.txt',
      contentType: 'text/plain',
      snapshot: { size: 13, etag: 'etag' },
      bytes: Buffer.from('MCP lesson\n'),
    }));
    const tool = createReadMcpResourceTool({ read }, 'secret');
    const result = await tool.execute(
      { resourceId: 'server/lesson' },
      { ownerId: 'owner', sessionId: 'session', conversationId: 'conversation' },
    );
    expect(read).toHaveBeenCalledWith(expect.objectContaining({
      resource: { kind: 'mcp_resource', id: 'server/lesson' },
    }));
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'MCP lesson' });
  });
});
