import { z } from 'zod';

const uploadContentTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

export const prepareUploadSchema = z.object({
  conversationId: z.string().uuid(),
  filename: z.string().trim().min(1).max(240),
  contentType: z.enum(uploadContentTypes),
  size: z.number().int().positive().max(15 * 1024 * 1024),
});

export const confirmUploadSchema = z.object({
  attachmentId: z.string().uuid(),
});

export type PrepareUploadInput = z.infer<typeof prepareUploadSchema>;
