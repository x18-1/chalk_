import { describe, expect, it, vi } from 'vitest';

import {
  createReadResourceTool,
  createResourceReader,
  type ResourceReadAdapter,
} from '../../../src/agent/tools/read/read-resource';

const context = { ownerId: 'student-1', sessionId: 'session-1', conversationId: 'conversation-1' };

function adapter(kind: string, text = '第一行\n第二行\n'): ResourceReadAdapter {
  const bytes = Buffer.from(text);
  return {
    kind,
    async read({ startByte, maxBytes }) {
      return {
        filename: `${kind}.txt`,
        contentType: 'text/plain',
        snapshot: { size: bytes.length, etag: `${kind}-etag` },
        bytes: bytes.subarray(startByte, startByte + maxBytes),
      };
    },
  };
}

describe('read_resource tool feature', () => {
  it('routes a resource to its adapter and keeps the resource identity in details', async () => {
    const read = vi.fn(adapter('upload').read);
    const reader = createResourceReader([{ kind: 'upload', read }]);
    const tool = createReadResourceTool(reader, 'test-secret');

    const result = await tool.execute({ resource: { kind: 'upload', id: 'attachment-1' }, maxLines: 1, maxBytes: 1_024 }, context);

    expect(read).toHaveBeenCalledWith(expect.objectContaining({
      resource: { kind: 'upload', id: 'attachment-1' },
      startByte: 0,
    }));
    expect(result.details).toMatchObject({ resource: { kind: 'upload', id: 'attachment-1' }, hasMore: true });
  });

  it('rejects unsupported resource kinds before calling an adapter', async () => {
    const read = vi.fn(adapter('upload').read);
    const tool = createReadResourceTool(createResourceReader([{ kind: 'upload', read }]), 'test-secret');

    await expect(tool.execute({ resource: { kind: 'web_page', id: 'result-1' } } as never, context))
      .rejects.toMatchObject({ code: 'read_unsupported_resource' });
    expect(read).not.toHaveBeenCalled();
  });

  it('rejects duplicate adapter kinds at construction time', () => {
    expect(() => createResourceReader([adapter('upload'), adapter('upload')]))
      .toThrow('Duplicate resource Read adapter');
  });
});
