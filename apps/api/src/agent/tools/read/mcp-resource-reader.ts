import { createHash } from 'node:crypto';

import {
  McpManager,
  ToolExecutionError,
} from '@chalk/agent-runtime';

import type {
  ResourceReadAdapter,
  ResourceReadRequest,
  ResourceReadResult,
} from './read-resource';

const MAX_REMOTE_RESOURCE_BYTES = 2 * 1024 * 1024;
type McpReadResourceResult = Awaited<ReturnType<McpManager['readResource']>>;

function splitResourceId(id: string) {
  const separator = id.indexOf('/');
  if (separator <= 0 || separator === id.length - 1) {
    throw new ToolExecutionError(
      'read_unsupported_resource',
      'An MCP resource id must be <server-id>/<resource-uri>',
    );
  }
  return {
    serverId: id.slice(0, separator),
    uri: id.slice(separator + 1),
  };
}

function textBytes(result: McpReadResourceResult, uri: string) {
  const textContents = result.contents.filter(
    (content): content is Extract<McpReadResourceResult['contents'][number], { text: string }> =>
      'text' in content,
  );
  if (textContents.length === 0) {
    throw new ToolExecutionError(
      'read_unsupported_media_type',
      'This MCP resource is not a text resource',
    );
  }

  const text = textContents.map((content) => content.text).join('\n');
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.byteLength > MAX_REMOTE_RESOURCE_BYTES) {
    throw new ToolExecutionError(
      'read_resource_too_large',
      `The MCP resource exceeds the ${MAX_REMOTE_RESOURCE_BYTES}-byte read limit`,
    );
  }
  return {
    bytes,
    contentType: textContents[0]?.mimeType ?? 'text/plain',
    etag: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    uri: textContents[0]?.uri ?? uri,
  };
}

/**
 * MCP resources have no byte-range operation in the current protocol. The
 * adapter therefore reads one bounded text resource, then lets the shared
 * read_resource facade paginate it and detect changes by content hash.
 */
export function createMcpResourceAdapter(manager: McpManager): ResourceReadAdapter {
  return {
    kind: 'mcp_resource',
    async read(request: ResourceReadRequest): Promise<ResourceReadResult> {
      const { serverId, uri } = splitResourceId(request.resource.id);
      const result = await manager.readResource(serverId, uri, request.signal);
      const normalized = textBytes(result, uri);
      return {
        filename: normalized.uri,
        contentType: normalized.contentType,
        snapshot: {
          size: normalized.bytes.byteLength,
          etag: normalized.etag,
        },
        bytes: normalized.bytes.subarray(
          request.startByte,
          request.startByte + request.maxBytes,
        ),
      };
    },
  };
}
