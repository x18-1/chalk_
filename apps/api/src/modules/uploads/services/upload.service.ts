import { randomUUID } from 'node:crypto';

import type { Database } from '../../../db/client';
import { createAttachmentsDal, createConversationsDal } from '../../../db/dal';
import { ApiError } from '../../../http/errors';
import type { PrepareUploadInput } from '../schemas';

export type UploadObjectStorage = {
  publicUrl(fileKey: string): string | undefined;
  createUploadUrl(input: {
    fileKey: string;
    contentType: string;
    size: number;
  }): Promise<string>;
  inspectObject(fileKey: string): Promise<{
    size?: number;
    contentType?: string;
  }>;
};

export class UploadService {
  private readonly attachments;
  private readonly conversations;

  constructor(
    db: Database,
    private readonly objectStorage: UploadObjectStorage,
  ) {
    this.attachments = createAttachmentsDal(db);
    this.conversations = createConversationsDal(db);
  }

  async prepareUpload(userId: string, input: PrepareUploadInput) {
    await this.conversations.getById(userId, input.conversationId);
    const safeFilename = input.filename
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(-120);
    const fileKey = [
      userId,
      input.conversationId,
      `${randomUUID()}-${safeFilename}`,
    ].join('/');
    const attachment = await this.attachments.create(userId, {
      conversationId: input.conversationId,
      fileKey,
      filename: input.filename,
      contentType: input.contentType,
      size: input.size,
      publicUrl: this.objectStorage.publicUrl(fileKey),
    });
    const uploadUrl = await this.objectStorage.createUploadUrl({
      fileKey,
      contentType: input.contentType,
      size: input.size,
    });
    return { attachmentId: attachment.id, fileKey, uploadUrl, expiresIn: 600 };
  }

  async confirmUpload(userId: string, attachmentId: string) {
    const attachment = await this.attachments.getById(userId, attachmentId);
    const object = await this.objectStorage.inspectObject(attachment.fileKey);
    if (object.size !== undefined && object.size !== attachment.size) {
      throw new ApiError(
        400,
        'Uploaded file size does not match the reservation',
        'UPLOAD_SIZE_MISMATCH',
      );
    }
    if (object.contentType && object.contentType !== attachment.contentType) {
      throw new ApiError(
        400,
        'Uploaded file type does not match the reservation',
        'UPLOAD_TYPE_MISMATCH',
      );
    }
    return this.attachments.confirm(
      userId,
      attachmentId,
      attachment.publicUrl ?? undefined,
    );
  }
}
