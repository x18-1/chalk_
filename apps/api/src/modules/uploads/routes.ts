import type { FastifyInstance } from 'fastify';

import type { AuthModule } from '../../auth/auth-module';
import { confirmUploadSchema, prepareUploadSchema } from './schemas';
import type { UploadService } from './services/upload.service';

export function registerUploadRoutes(
  app: FastifyInstance,
  auth: AuthModule,
  uploads: UploadService,
) {
  app.post('/uploads/presign', async (request) => {
    const user = await auth.requireUser(request);
    return uploads.prepareUpload(user.id, prepareUploadSchema.parse(request.body));
  });

  app.post('/uploads/confirm', async (request) => {
    const user = await auth.requireUser(request);
    const { attachmentId } = confirmUploadSchema.parse(request.body);
    return { attachment: await uploads.confirmUpload(user.id, attachmentId) };
  });
}
