import { ToolExecutionError } from '@chalk/agent-runtime';

import { createAttachmentsDal } from '../../../db/dal';
import type { Database } from '../../../db/client';
import { AuthRequiredError, OwnershipError } from '../../../db/errors';
import { inspectUploadedObject, readUploadedObjectRange } from '../../../storage/s3';
import type {
  UploadedFileReadRequest,
  UploadedFileReadResult,
  UploadedFileReader,
} from './read-uploaded-file';
import type {
  ResourceReadAdapter,
  ResourceReadRequest,
  ResourceReadResult,
} from './read-resource';

const TEXT_TYPES = new Set([
  'application/json',
  'application/javascript',
  'application/xml',
  'text/csv',
  'text/html',
  'text/markdown',
  'text/plain',
  'text/xml',
]);

export type OwnedAttachment = {
  conversationId: string;
  status: string;
  fileKey: string;
  filename: string;
  contentType: string;
};

export type AttachmentReader = {
  getById(ownerId: string, attachmentId: string): Promise<OwnedAttachment>;
};

export type ObjectReader = {
  inspect(fileKey: string): Promise<{ size: number; etag?: string; lastModified?: number }>;
  readRange(fileKey: string, startByte: number, maxBytes: number): Promise<Uint8Array>;
};

function isTextType(contentType: string, filename: string) {
  return contentType.startsWith('text/') || TEXT_TYPES.has(contentType) || /\.(txt|md|csv|json|xml|html|css|js|ts|tsx|jsx)$/i.test(filename);
}

export function createUploadedFileReaderFromAdapters(
  attachments: AttachmentReader,
  objects: ObjectReader,
): UploadedFileReader {
  return {
    async read(request: UploadedFileReadRequest): Promise<UploadedFileReadResult> {
      const conversationId = request.context.conversationId;
      if (!conversationId) throw new ToolExecutionError('read_access_denied', 'Reading an uploaded file requires a conversation context');
      if (!Number.isSafeInteger(request.startByte) || request.startByte < 0 || !Number.isSafeInteger(request.maxBytes) || request.maxBytes < 1) {
        throw new Error('Uploaded file read range is invalid');
      }
      let attachment: OwnedAttachment;
      try {
        attachment = await attachments.getById(request.context.ownerId, request.attachmentId);
      } catch (error) {
        if (error instanceof AuthRequiredError || error instanceof OwnershipError) {
          throw new ToolExecutionError('read_access_denied', 'The uploaded file is not available in this conversation', error);
        }
        throw error;
      }
      if (attachment.conversationId !== conversationId || attachment.status !== 'ready') {
        throw new ToolExecutionError('read_access_denied', 'The uploaded file is not available in this conversation');
      }
      if (!isTextType(attachment.contentType, attachment.filename)) {
        throw new ToolExecutionError('read_unsupported_media_type', 'This Read tool currently supports text files only');
      }
      const metadata = await objects.inspect(attachment.fileKey);
      if (!Number.isSafeInteger(metadata.size) || metadata.size < 0) {
        throw new Error('Uploaded object metadata has an invalid size');
      }
      if (request.startByte >= metadata.size) {
        return {
          filename: attachment.filename,
          contentType: attachment.contentType,
          snapshot: {
            size: metadata.size,
            ...(metadata.etag ? { etag: metadata.etag } : {}),
            ...(metadata.lastModified !== undefined ? { lastModified: metadata.lastModified } : {}),
          },
          bytes: new Uint8Array(),
        };
      }
      const bytes = await objects.readRange(attachment.fileKey, request.startByte, request.maxBytes);
      const remainingBytes = metadata.size - request.startByte;
      return {
        filename: attachment.filename,
        contentType: attachment.contentType,
        snapshot: {
          size: metadata.size,
          ...(metadata.etag ? { etag: metadata.etag } : {}),
          ...(metadata.lastModified !== undefined ? { lastModified: metadata.lastModified } : {}),
        },
        bytes: bytes.subarray(0, Math.min(request.maxBytes, remainingBytes)),
      };
    },
  };
}

export function createUploadedFileResourceAdapter(
  attachments: AttachmentReader,
  objects: ObjectReader,
): ResourceReadAdapter {
  const reader = createUploadedFileReaderFromAdapters(attachments, objects);
  return {
    kind: 'upload',
    async read(request: ResourceReadRequest): Promise<ResourceReadResult> {
      if (request.resource.kind !== 'upload') {
        throw new ToolExecutionError('read_unsupported_resource', 'Resource kind is not supported by the upload adapter');
      }
      return reader.read({
        context: request.context,
        attachmentId: request.resource.id,
        startByte: request.startByte,
        maxBytes: request.maxBytes,
      });
    },
  };
}

export function createUploadedFileResourceAdapterFromDatabase(db: Database): ResourceReadAdapter {
  return createUploadedFileResourceAdapter(createAttachmentsDal(db), {
    async inspect(fileKey) {
      const metadata = await inspectUploadedObject(fileKey);
      return {
        size: metadata.size,
        ...(metadata.etag ? { etag: metadata.etag } : {}),
        ...(metadata.lastModified !== undefined ? { lastModified: metadata.lastModified } : {}),
      };
    },
    readRange: readUploadedObjectRange,
  });
}

export function createUploadedFileReader(db: Database): UploadedFileReader {
  return createUploadedFileReaderFromAdapters(createAttachmentsDal(db), {
    async inspect(fileKey) {
      const metadata = await inspectUploadedObject(fileKey);
      return {
        size: metadata.size,
        ...(metadata.etag ? { etag: metadata.etag } : {}),
        ...(metadata.lastModified ? { lastModified: metadata.lastModified } : {}),
      };
    },
    readRange: readUploadedObjectRange,
  });
}
