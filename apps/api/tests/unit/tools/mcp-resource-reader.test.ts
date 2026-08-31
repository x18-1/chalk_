import { describe, expect, it, vi } from 'vitest';

import { createMcpResourceAdapter } from '../../../src/agent/tools/mcp-tool/resource-reader';

describe('MCP ResourceReadAdapter', () => {
  it('reads text resources using <server-id>/<resource-uri> references', async () => {
    const readResource = vi.fn(async () => ({
      contents: [{
        uri: 'chalk://fixture/lesson-notes',
        mimeType: 'text/plain',
        text: '第一行\n第二行\n',
      }],
    }));
    const adapter = createMcpResourceAdapter({ readResource } as never);

    const result = await adapter.read({
      context: { ownerId: 'student-1', sessionId: 'session-1', conversationId: 'conversation-1' },
      resource: { kind: 'mcp_resource', id: 'fixture/chalk://fixture/lesson-notes' },
      startByte: 0,
      maxBytes: 1_024,
    });

    expect(readResource).toHaveBeenCalledWith('fixture', 'chalk://fixture/lesson-notes', undefined);
    expect(Buffer.from(result.bytes).toString('utf8')).toBe('第一行\n第二行\n');
    expect(result.snapshot).toMatchObject({ size: result.bytes.byteLength, etag: expect.stringMatching(/^sha256:/) });
  });

  it('rejects non-text resources', async () => {
    const adapter = createMcpResourceAdapter({
      readResource: vi.fn(async () => ({
        contents: [{
          uri: 'chalk://fixture/image',
          mimeType: 'image/png',
          blob: 'aGVsbG8=',
        }],
      })),
    } as never);

    await expect(adapter.read({
      context: { ownerId: 'student-1', sessionId: 'session-1', conversationId: 'conversation-1' },
      resource: { kind: 'mcp_resource', id: 'fixture/chalk://fixture/image' },
      startByte: 0,
      maxBytes: 1_024,
    })).rejects.toMatchObject({ code: 'read_unsupported_media_type' });
  });

  it('rejects malformed resource references', async () => {
    const adapter = createMcpResourceAdapter({ readResource: vi.fn() } as never);

    await expect(adapter.read({
      context: { ownerId: 'student-1', sessionId: 'session-1', conversationId: 'conversation-1' },
      resource: { kind: 'mcp_resource', id: 'missing-uri' },
      startByte: 0,
      maxBytes: 1_024,
    })).rejects.toMatchObject({ code: 'read_unsupported_resource' });
  });
});
