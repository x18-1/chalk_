import { randomUUID } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AuthModule } from '../../auth/auth-module';
import { getDb } from '../../db/client';
import { createAttachmentsDal, createConversationsDal } from '../../db/dal';
import { confirmUploadedObject, createUploadUrl, publicObjectUrl } from '../../storage/s3';
import { ApiError } from '../../http/errors';

const contentTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
const presignSchema = z.object({
  conversationId: z.string().uuid(),
  filename: z.string().trim().min(1).max(240),
  contentType: z.enum(contentTypes),
  size: z.number().int().positive().max(15 * 1024 * 1024),
});

export function registerUploadRoutes(app: FastifyInstance, auth: AuthModule) {
  app.post('/uploads/presign', async (request) => {
    const user = await auth.requireUser(request);
    const input = presignSchema.parse(request.body);
    await createConversationsDal(getDb()).getById(user.id, input.conversationId);
    const safeFilename = input.filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const fileKey = `${user.id}/${input.conversationId}/${randomUUID()}-${safeFilename}`;
    const attachment = await createAttachmentsDal(getDb()).create(user.id, {
      conversationId: input.conversationId,
      fileKey,
      filename: input.filename,
      contentType: input.contentType,
      size: input.size,
      publicUrl: publicObjectUrl(fileKey),
    });
    const uploadUrl = await createUploadUrl({ fileKey, contentType: input.contentType, size: input.size });
    return { attachmentId: attachment.id, fileKey, uploadUrl, expiresIn: 600 };
  });

  app.post('/uploads/confirm', async (request) => {
    const user = await auth.requireUser(request);
    const { attachmentId } = z.object({ attachmentId: z.string().uuid() }).parse(request.body);
    const dal = createAttachmentsDal(getDb());
    const attachment = await dal.getById(user.id, attachmentId);
    const object = await confirmUploadedObject(attachment.fileKey);
    if (object.ContentLength !== undefined && object.ContentLength !== attachment.size) {
      throw new ApiError(400, 'Uploaded file size does not match the reservation', 'UPLOAD_SIZE_MISMATCH');
    }
    if (object.ContentType && object.ContentType !== attachment.contentType) {
      throw new ApiError(400, 'Uploaded file type does not match the reservation', 'UPLOAD_TYPE_MISMATCH');
    }
    return { attachment: await dal.confirm(user.id, attachmentId, attachment.publicUrl ?? undefined) };
  });
}
