import { createHmac, timingSafeEqual } from 'node:crypto';

import { Type, type Static } from 'typebox';

import {
  ToolExecutionError,
  type RuntimeTool,
  type RuntimeToolContext,
} from '@chalk/agent-runtime';

export const readResourceParameters = Type.Object({
  resource: Type.Object({
    kind: Type.String({ minLength: 1, maxLength: 40 }),
    id: Type.String({ minLength: 1, maxLength: 512 }),
  }),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  maxLines: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  maxBytes: Type.Optional(Type.Integer({ minimum: 1_024, maximum: 32_768 })),
});

type ReadArguments = Static<typeof readResourceParameters>;

export type ResourceReference = {
  kind: string;
  id: string;
};

export type ResourceReadSnapshot = {
  size: number;
  etag?: string;
  lastModified?: number;
};

export type ResourceReadRequest = {
  context: RuntimeToolContext;
  resource: ResourceReference;
  startByte: number;
  maxBytes: number;
  signal?: AbortSignal;
};

export type ResourceReadResult = {
  filename: string;
  contentType: string;
  snapshot: ResourceReadSnapshot;
  bytes: Uint8Array;
};

export interface ResourceReadAdapter {
  readonly kind: string;
  read(request: ResourceReadRequest): Promise<ResourceReadResult>;
}

export interface ResourceReader {
  read(request: ResourceReadRequest): Promise<ResourceReadResult>;
}

export function createResourceReader(adapters: readonly ResourceReadAdapter[]): ResourceReader {
  const byKind = new Map<string, ResourceReadAdapter>();
  for (const adapter of adapters) {
    if (!adapter.kind || byKind.has(adapter.kind)) throw new Error(`Duplicate resource Read adapter: ${adapter.kind}`);
    byKind.set(adapter.kind, adapter);
  }
  return {
    async read(request) {
      const adapter = byKind.get(request.resource.kind);
      if (!adapter) throw new ToolExecutionError('read_unsupported_resource', `Resource kind is not supported: ${request.resource.kind}`);
      return adapter.read(request);
    },
  };
}

type CursorPayload = {
  v: 1;
  ownerId: string;
  conversationId: string;
  resource: ResourceReference;
  nextByte: number;
  nextLine: number;
  snapshot: ResourceReadSnapshot;
  expiresAt: number;
};

const CURSOR_TTL_MS = 15 * 60_000;
const DEFAULT_MAX_LINES = 120;
const DEFAULT_MAX_BYTES = 16_384;
const MAX_RESULT_CHARACTERS = 10_000;

function encodeCursor(payload: CursorPayload, secret: string) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function decodeCursor(value: string, secret: string): CursorPayload {
  const parts = value.split('.');
  const [body, signature] = parts;
  if (parts.length !== 2 || !body || !signature) throw new ToolExecutionError('read_cursor_invalid', 'The read continuation token is invalid');
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    throw new ToolExecutionError('read_cursor_invalid', 'The read continuation token is invalid');
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (error) {
    throw new ToolExecutionError('read_cursor_invalid', 'The read continuation token is invalid', error);
  }
  if (!payload || typeof payload !== 'object') throw new ToolExecutionError('read_cursor_invalid', 'The read continuation token is invalid');
  const candidate = payload as Partial<CursorPayload>;
  const resource = candidate.resource as Partial<ResourceReference> | undefined;
  const snapshot = candidate.snapshot as Partial<ResourceReadSnapshot> | undefined;
  const nextByte = candidate.nextByte;
  const nextLine = candidate.nextLine;
  const expiresAt = candidate.expiresAt;
  const snapshotSize = snapshot?.size;
  if (
    candidate.v !== 1
    || typeof candidate.ownerId !== 'string' || !candidate.ownerId
    || typeof candidate.conversationId !== 'string' || !candidate.conversationId
    || !resource || typeof resource.kind !== 'string' || !resource.kind || typeof resource.id !== 'string' || !resource.id
    || typeof nextByte !== 'number' || !Number.isSafeInteger(nextByte) || nextByte < 0
    || typeof nextLine !== 'number' || !Number.isSafeInteger(nextLine) || nextLine < 1
    || !snapshot || typeof snapshotSize !== 'number' || !Number.isSafeInteger(snapshotSize) || snapshotSize < 0
    || (snapshot.etag !== undefined && typeof snapshot.etag !== 'string')
    || (snapshot.lastModified !== undefined && !Number.isSafeInteger(snapshot.lastModified))
    || typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt)
  ) throw new ToolExecutionError('read_cursor_invalid', 'The read continuation token is invalid');
  if (nextByte > snapshotSize) throw new ToolExecutionError('read_cursor_invalid', 'The read continuation token is invalid');
  if (expiresAt <= Date.now()) throw new ToolExecutionError('read_cursor_expired', 'The read continuation token has expired');
  return candidate as CursorPayload;
}

function sameResource(left: ResourceReference, right: ResourceReference) {
  return left.kind === right.kind && left.id === right.id;
}

function sameSnapshot(left: ResourceReadSnapshot, right: ResourceReadSnapshot) {
  return left.size === right.size && left.etag === right.etag && left.lastModified === right.lastModified;
}

function readLines(bytes: Uint8Array, startByte: number, startLine: number, maxLines: number, maxBytes: number, atEof: boolean) {
  const buffer = Buffer.from(bytes);
  const lines: string[] = [];
  let cursor = 0;
  let lineNumber = startLine;
  let consumed = 0;
  while (cursor < buffer.length && lines.length < maxLines) {
    const newline = buffer.indexOf(0x0a, cursor);
    const hasNewline = newline >= 0;
    const end = hasNewline ? newline : buffer.length;
    if (!hasNewline && !atEof) break;
    const text = buffer.subarray(cursor, end).toString('utf8').replace(/\r$/, '');
    if (text.length > MAX_RESULT_CHARACTERS) throw new ToolExecutionError('read_line_too_large', 'A single line is too large to return safely');
    if (lines.join('\n').length + text.length + (lines.length ? 1 : 0) > MAX_RESULT_CHARACTERS) break;
    lines.push(text);
    cursor = hasNewline ? end + 1 : end;
    consumed = cursor;
    lineNumber += 1;
  }
  if (!lines.length && cursor === 0 && !atEof && buffer.length >= maxBytes) {
    throw new ToolExecutionError('read_line_too_large', 'A line does not fit in the requested read range; increase maxBytes');
  }
  const readBytes = Math.min(buffer.length, maxBytes);
  const nextByte = startByte + consumed;
  const hasMore = nextByte < startByte + readBytes || (!atEof && readBytes === maxBytes);
  return { lines, nextByte, nextLine: lineNumber, hasMore };
}

export function createReadResourceTool(reader: ResourceReader, cursorSecret: string): RuntimeTool<typeof readResourceParameters> {
  if (!cursorSecret) throw new Error('Resource Read tool requires a cursor secret');
  return {
    name: 'read_resource',
    label: '读取资源',
    description: '按有限行数读取当前会话中有权限访问的文本资源；结果过长时返回继续读取令牌，不会一次性加载整个资源。',
    parameters: readResourceParameters,
    source: 'chalk',
    effects: ['read', 'network'],
    approvalPolicy: 'none',
    defaultEnabled: true,
    executionMode: 'parallel',
    limits: { maxResultCharacters: 12_000, maxUpdateCharacters: 2_000 },
    async execute(args: ReadArguments, context, signal) {
      if (!context.conversationId) throw new ToolExecutionError('read_access_denied', 'Reading a resource requires a conversation context');
      const maxLines = args.maxLines ?? DEFAULT_MAX_LINES;
      const maxBytes = args.maxBytes ?? DEFAULT_MAX_BYTES;
      const cursor = args.cursor ? decodeCursor(args.cursor, cursorSecret) : undefined;
      if (cursor && (cursor.ownerId !== context.ownerId || cursor.conversationId !== context.conversationId || !sameResource(cursor.resource, args.resource))) {
        throw new ToolExecutionError('read_access_denied', 'The read continuation token is not valid for this conversation or resource');
      }
      const startByte = cursor?.nextByte ?? 0;
      const startLine = cursor?.nextLine ?? 1;
      const result = await reader.read({ context, resource: args.resource, startByte, maxBytes, signal });
      if (signal?.aborted) throw new ToolExecutionError('cancelled', 'Resource reading was cancelled');
      if (cursor && !sameSnapshot(cursor.snapshot, result.snapshot)) throw new ToolExecutionError('read_snapshot_changed', 'The resource changed while it was being read');
      const bytes = result.bytes.subarray(0, maxBytes);
      const page = readLines(bytes, startByte, startLine, maxLines, maxBytes, startByte + bytes.length >= result.snapshot.size);
      const continuation = page.hasMore
        ? encodeCursor({ v: 1, ownerId: context.ownerId, conversationId: context.conversationId, resource: args.resource, nextByte: page.nextByte, nextLine: page.nextLine, snapshot: result.snapshot, expiresAt: Date.now() + CURSOR_TTL_MS }, cursorSecret)
        : undefined;
      const text = page.lines.join('\n');
      return {
        content: [{ type: 'text', text: page.lines.length === 0 ? '[资源没有可读取的文本内容]' : text }],
        details: {
          resource: args.resource,
          filename: result.filename,
          contentType: result.contentType,
          startLine,
          endLine: Math.max(startLine - 1, page.nextLine - 1),
          startByte,
          nextByte: page.nextByte,
          hasMore: page.hasMore,
          ...(continuation ? { continuation: { cursor: continuation, nextLine: page.nextLine } } : {}),
        },
      };
    },
  };
}
