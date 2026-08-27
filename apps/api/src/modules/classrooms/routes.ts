import type { FastifyInstance } from 'fastify';

import type { AuthModule } from '../../auth/auth-module';
import { ApiError } from '../../http/errors';
import {
  classroomArtifactParamsSchema,
  classroomParamsSchema,
  createArtifactSchema,
  createClassroomSchema,
} from './schemas';
import type { ClassroomService } from './services/classroom.service';

export function registerClassroomRoutes(
  app: FastifyInstance,
  auth: AuthModule,
  classrooms: ClassroomService,
) {
  app.post('/classrooms', async (request, reply) => {
    const user = await auth.requireUser(request);
    const classroom = await classrooms.createClassroom(
      user.id,
      createClassroomSchema.parse(request.body),
    );
    return reply.code(201).send({ classroom });
  });

  app.get('/classrooms', async (request) => {
    const user = await auth.requireUser(request);
    return { classrooms: await classrooms.listClassrooms(user.id) };
  });

  app.post('/classrooms/import', async (request, reply) => {
    const user = await auth.requireUser(request);
    let file;
    try {
      file = await request.file();
    } catch (error) {
      throw mapArchiveUploadError(error);
    }
    if (!file) return reply.code(400).send({ error: 'Classroom archive is required', code: 'CLASSROOM_ARCHIVE_REQUIRED' });
    if (file.fieldname !== 'file') {
      file.file.resume();
      throw new ApiError(
        400,
        'Classroom archive must use the file field',
        'CLASSROOM_ARCHIVE_FIELD_INVALID',
      );
    }
    let body: Buffer;
    try {
      body = await file.toBuffer();
    } catch (error) {
      throw mapArchiveUploadError(error);
    }
    const imported = await classrooms.importArchive(user.id, {
      filename: file.filename,
      contentType: file.mimetype,
      body,
    });
    return reply.code(imported.created ? 201 : 200).send({ classroom: imported.classroom });
  });

  app.get('/classrooms/:classroomId/artifacts/:artifactId', async (request) => {
    const user = await auth.requireUser(request);
    const { classroomId, artifactId } = classroomArtifactParamsSchema.parse(request.params);
    return classrooms.getArtifact(user.id, classroomId, artifactId);
  });

  app.post('/classrooms/:classroomId/artifacts', async (request, reply) => {
    const user = await auth.requireUser(request);
    const { classroomId } = classroomParamsSchema.parse(request.params);
    const { document } = createArtifactSchema.parse(request.body);
    return reply.code(201).send(await classrooms.createArtifact(user.id, classroomId, document));
  });
}

function mapArchiveUploadError(error: unknown) {
  if (
    typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'FST_REQ_FILE_TOO_LARGE'
  ) {
    return new ApiError(
      413,
      'Classroom archive exceeds the 32 MiB upload limit',
      'CLASSROOM_ARCHIVE_TOO_LARGE',
    );
  }
  return error;
}
