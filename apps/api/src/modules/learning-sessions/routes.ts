import type { FastifyInstance } from 'fastify';

import type { AuthModule } from '../../auth/auth-module';
import {
  learningSessionArtifactParamsSchema,
  learningSessionParamsSchema,
  savePlaybackCursorSchema,
} from './schemas';
import type { LearningSessionService } from './services/learning-session.service';

export function registerLearningSessionRoutes(
  app: FastifyInstance,
  auth: AuthModule,
  learningSessions: LearningSessionService,
) {
  app.post('/classrooms/:classroomId/artifacts/:artifactId/learning-session', async (request, reply) => {
    const user = await auth.requireUser(request);
    const { classroomId, artifactId } = learningSessionArtifactParamsSchema.parse(request.params);
    const result = await learningSessions.createOrResume(user.id, classroomId, artifactId);
    return reply.code(result.created ? 201 : 200).send(result);
  });

  app.get('/learning-sessions/:sessionId', async (request) => {
    const user = await auth.requireUser(request);
    const { sessionId } = learningSessionParamsSchema.parse(request.params);
    return learningSessions.get(user.id, sessionId);
  });

  app.put('/learning-sessions/:sessionId/cursor', async (request) => {
    const user = await auth.requireUser(request);
    const { sessionId } = learningSessionParamsSchema.parse(request.params);
    return learningSessions.saveCursor(
      user.id,
      sessionId,
      savePlaybackCursorSchema.parse(request.body),
    );
  });
}
