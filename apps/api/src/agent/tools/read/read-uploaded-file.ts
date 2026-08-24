import { Type, type Static } from 'typebox';

import { type RuntimeTool, type RuntimeToolContext } from '@chalk/agent-runtime';

import {
  createReadResourceTool,
  type ResourceReadRequest,
  type ResourceReadResult,
} from './read-resource';

export const readUploadedFileParameters = Type.Object({
  attachmentId: Type.String({ minLength: 1, maxLength: 100 }),
  cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
  maxLines: Type.Optional(Type.Integer({ minimum: 1, maximum: 200 })),
  maxBytes: Type.Optional(Type.Integer({ minimum: 1_024, maximum: 32_768 })),
});

export type UploadedFileReadRequest = {
  context: RuntimeToolContext;
  attachmentId: string;
  startByte: number;
  maxBytes: number;
};

export type UploadedFileReadResult = {
  filename: string;
  contentType: string;
  snapshot: {
    size: number;
    etag?: string;
    lastModified?: number;
  };
  bytes: Uint8Array;
};

export interface UploadedFileReader {
  read(request: UploadedFileReadRequest): Promise<UploadedFileReadResult>;
}

/** Compatibility wrapper; the public registry uses read_resource. */
export function createReadUploadedFileTool(
  reader: UploadedFileReader,
  cursorSecret: string,
): RuntimeTool<typeof readUploadedFileParameters> {
  const resourceTool = createReadResourceTool({
    async read(request: ResourceReadRequest): Promise<ResourceReadResult> {
      return reader.read({
        context: request.context,
        attachmentId: request.resource.id,
        startByte: request.startByte,
        maxBytes: request.maxBytes,
      });
    },
  }, cursorSecret);
  return {
    name: 'read_uploaded_file',
    label: '读取上传文件',
    description: '按有限行数读取当前会话中用户已上传的文本文件；结果过长时返回继续读取令牌，不会一次性加载整个文件。',
    parameters: readUploadedFileParameters,
    source: 'chalk',
    effects: ['read', 'network'],
    approvalPolicy: 'none',
    defaultEnabled: true,
    executionMode: 'parallel',
    limits: { maxResultCharacters: 12_000, maxUpdateCharacters: 2_000 },
    async execute(args: Static<typeof readUploadedFileParameters>, context, signal) {
      const result = await resourceTool.execute({
        resource: { kind: 'upload', id: args.attachmentId },
        cursor: args.cursor,
        maxLines: args.maxLines,
        maxBytes: args.maxBytes,
      }, context, signal);
      const details = result.details as Record<string, unknown>;
      return {
        ...result,
        details: {
          ...details,
          attachmentId: args.attachmentId,
        },
      };
    },
  };
}
