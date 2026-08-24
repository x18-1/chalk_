import { createHmac } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createReadUploadedFileTool, type UploadedFileReader } from '../../src/agent/tools/read/read-uploaded-file';
import { createUploadedFileReaderFromAdapters } from '../../src/agent/tools/read/uploaded-file-reader';
import { OwnershipError } from '../../src/db/errors';

const context = { ownerId: 'student-1', sessionId: 'session-1', conversationId: 'conversation-1' };
const snapshot = { size: 30, etag: 'etag-1', lastModified: 1 };

function createReader(text: string, nextSnapshot = snapshot): UploadedFileReader {
  const bytes = Buffer.from(text, 'utf8');
  return {
    async read({ startByte, maxBytes }) {
      return {
        filename: 'lesson.txt',
        contentType: 'text/plain',
        snapshot: nextSnapshot,
        bytes: bytes.subarray(startByte, startByte + maxBytes),
      };
    },
  };
}

function reSignCursor(cursor: string, mutate: (payload: Record<string, unknown>) => void) {
  const [body] = cursor.split('.', 2);
  const payload = JSON.parse(Buffer.from(body!, 'base64url').toString('utf8')) as Record<string, unknown>;
  mutate(payload);
  const nextBody = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', 'test-secret').update(nextBody).digest('base64url');
  return `${nextBody}.${signature}`;
}

describe('read_uploaded_file', () => {
  it('returns a bounded page and a continuation cursor', async () => {
    const tool = createReadUploadedFileTool(createReader('第一行\n第二行\n第三行\n'), 'test-secret');
    const first = await tool.execute({ attachmentId: 'attachment-1', maxLines: 2, maxBytes: 1024 }, context);

    expect(first.content).toEqual([{ type: 'text', text: '第一行\n第二行' }]);
    expect(first.details).toMatchObject({ startLine: 1, endLine: 2, hasMore: true });
    const cursor = (first.details as { continuation: { cursor: string } }).continuation.cursor;
    const second = await tool.execute({ attachmentId: 'attachment-1', cursor, maxLines: 2, maxBytes: 1024 }, context);

    expect(second.content).toEqual([{ type: 'text', text: '第三行' }]);
    expect(second.details).toMatchObject({ startLine: 3, endLine: 3, hasMore: false });
  });

  it('does not issue a continuation when the range ends exactly at EOF', async () => {
    const text = 'a\nb\n';
    const tool = createReadUploadedFileTool(createReader(text, { size: Buffer.byteLength(text), etag: 'exact', lastModified: 2 }), 'test-secret');
    const result = await tool.execute({ attachmentId: 'attachment-1', maxLines: 10, maxBytes: Buffer.byteLength(text) }, context);

    expect(result.details).toMatchObject({ hasMore: false });
    expect(result.details).not.toHaveProperty('continuation');
  });

  it('preserves an empty line instead of mislabeling it as an empty file', async () => {
    const text = '\n';
    const tool = createReadUploadedFileTool(createReader(text, { size: 1, etag: 'blank', lastModified: 4 }), 'test-secret');
    const result = await tool.execute({ attachmentId: 'attachment-1', maxLines: 1, maxBytes: 1_024 }, context);

    expect(result.content).toEqual([{ type: 'text', text: '' }]);
  });

  it('rejects a cursor used by another conversation', async () => {
    const tool = createReadUploadedFileTool(createReader('第一行\n第二行\n'), 'test-secret');
    const first = await tool.execute({ attachmentId: 'attachment-1', maxLines: 1, maxBytes: 1024 }, context);
    const cursor = (first.details as { continuation: { cursor: string } }).continuation.cursor;

    await expect(tool.execute({ attachmentId: 'attachment-1', cursor }, {
      ...context,
      ownerId: 'student-2',
    })).rejects.toMatchObject({ code: 'read_access_denied' });
  });

  it('rejects a cursor when the resource snapshot changed', async () => {
    const firstTool = createReadUploadedFileTool(createReader('第一行\n第二行\n'), 'test-secret');
    const first = await firstTool.execute({ attachmentId: 'attachment-1', maxLines: 1, maxBytes: 1024 }, context);
    const cursor = (first.details as { continuation: { cursor: string } }).continuation.cursor;
    const changedTool = createReadUploadedFileTool(createReader('第一行\n第二行\n', { ...snapshot, etag: 'etag-2' }), 'test-secret');

    await expect(changedTool.execute({ attachmentId: 'attachment-1', cursor }, context))
      .rejects.toMatchObject({ code: 'read_snapshot_changed' });
  });

  it('rejects a cursor after its expiry time', async () => {
    const tool = createReadUploadedFileTool(createReader('第一行\n第二行\n'), 'test-secret');
    const first = await tool.execute({ attachmentId: 'attachment-1', maxLines: 1, maxBytes: 1024 }, context);
    const cursor = (first.details as { continuation: { cursor: string } }).continuation.cursor;
    const expired = reSignCursor(cursor, (payload) => { payload.expiresAt = Date.now() - 1; });

    await expect(tool.execute({ attachmentId: 'attachment-1', cursor: expired }, context))
      .rejects.toMatchObject({ code: 'read_cursor_expired' });
  });

  it('rejects a cursor with an extra segment instead of ignoring it', async () => {
    const tool = createReadUploadedFileTool(createReader('第一行\n第二行\n'), 'test-secret');
    const first = await tool.execute({ attachmentId: 'attachment-1', maxLines: 1, maxBytes: 1024 }, context);
    const cursor = (first.details as { continuation: { cursor: string } }).continuation.cursor;

    await expect(tool.execute({ attachmentId: 'attachment-1', cursor: `${cursor}.extra` }, context))
      .rejects.toMatchObject({ code: 'read_cursor_invalid' });
  });

  it('rejects a single line that cannot fit in a bounded result', async () => {
    const tool = createReadUploadedFileTool(createReader(`${'x'.repeat(10_001)}\n`), 'test-secret');

    await expect(tool.execute({ attachmentId: 'attachment-1' }, context))
      .rejects.toMatchObject({ code: 'read_line_too_large' });
  });

  it('does not return a non-advancing cursor when a line crosses the range boundary', async () => {
    const text = `${'x'.repeat(1_500)}\nnext\n`;
    const tool = createReadUploadedFileTool(
      createReader(text, { size: Buffer.byteLength(text), etag: 'long-line', lastModified: 3 }),
      'test-secret',
    );

    await expect(tool.execute({ attachmentId: 'attachment-1', maxBytes: 1_024 }, context))
      .rejects.toMatchObject({ code: 'read_line_too_large' });
  });

  it('checks attachment ownership and conversation scope before reading object bytes', async () => {
    const readRange = vi.fn(async () => Buffer.from('secret\n'));
    const reader = createUploadedFileReaderFromAdapters({
      async getById() {
        return { conversationId: 'other-conversation', status: 'ready', fileKey: 'private-key', filename: 'private.txt', contentType: 'text/plain' };
      },
    }, {
      inspect: async () => ({ size: 7, etag: 'etag' }),
      readRange,
    });

    await expect(reader.read({ context, attachmentId: 'attachment-1', startByte: 0, maxBytes: 1024 }))
      .rejects.toMatchObject({ code: 'read_access_denied' });
    expect(readRange).not.toHaveBeenCalled();
  });

  it('normalizes DAL ownership failures to the Read access-denied code', async () => {
    const reader = createUploadedFileReaderFromAdapters({
      async getById() {
        throw new OwnershipError('attachment', 'attachment-1');
      },
    }, {
      inspect: async () => ({ size: 1 }),
      readRange: async () => Buffer.from('x'),
    });

    await expect(reader.read({ context, attachmentId: 'attachment-1', startByte: 0, maxBytes: 1_024 }))
      .rejects.toMatchObject({ code: 'read_access_denied' });
  });

  it('refuses binary attachments before exposing bytes to the model', async () => {
    const readRange = vi.fn(async () => Buffer.from('not text'));
    const reader = createUploadedFileReaderFromAdapters({
      async getById() {
        return { conversationId: context.conversationId!, status: 'ready', fileKey: 'image-key', filename: 'image.png', contentType: 'image/png' };
      },
    }, {
      inspect: async () => ({ size: 8 }),
      readRange,
    });

    await expect(reader.read({ context, attachmentId: 'attachment-1', startByte: 0, maxBytes: 1024 }))
      .rejects.toMatchObject({ code: 'read_unsupported_media_type' });
    expect(readRange).not.toHaveBeenCalled();
  });

  it('does not request a range past EOF and clamps an oversized adapter response', async () => {
    const readRange = vi.fn(async () => Buffer.from('abcdef'));
    const reader = createUploadedFileReaderFromAdapters({
      async getById() {
        return { conversationId: context.conversationId!, status: 'ready', fileKey: 'text-key', filename: 'text.txt', contentType: 'text/plain' };
      },
    }, {
      inspect: async () => ({ size: 3, etag: 'etag' }),
      readRange,
    });

    const first = await reader.read({ context, attachmentId: 'attachment-1', startByte: 0, maxBytes: 1024 });
    expect(first.bytes).toEqual(Buffer.from('abc'));
    expect(readRange).toHaveBeenCalledWith('text-key', 0, 1024);

    readRange.mockClear();
    const eof = await reader.read({ context, attachmentId: 'attachment-1', startByte: 3, maxBytes: 1024 });
    expect(eof.bytes).toEqual(new Uint8Array());
    expect(readRange).not.toHaveBeenCalled();
  });
});
