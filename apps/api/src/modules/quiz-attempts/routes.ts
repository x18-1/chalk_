import type { FastifyInstance } from 'fastify';

import type { AuthModule } from '../../auth/auth-module';
import {
  quizAttemptParamsSchema,
  quizAttemptSessionParamsSchema,
  saveQuizAttemptSchema,
} from './schemas';
import type { QuizAttemptService } from './services/quiz-attempt.service';

export function registerQuizAttemptRoutes(
  app: FastifyInstance,
  auth: AuthModule,
  quizAttempts: QuizAttemptService,
) {
  app.get('/learning-sessions/:sessionId/quiz-attempts', async (request) => {
    const user = await auth.requireUser(request);
    const { sessionId } = quizAttemptSessionParamsSchema.parse(request.params);
    return quizAttempts.list(user.id, sessionId);
  });

  app.put('/learning-sessions/:sessionId/quiz-attempts/:sceneId', async (request, reply) => {
    const user = await auth.requireUser(request);
    const { sessionId, sceneId } = quizAttemptParamsSchema.parse(request.params);
    const result = await quizAttempts.save(
      user.id,
      sessionId,
      sceneId,
      saveQuizAttemptSchema.parse(request.body),
    );
    return reply.code(result.created ? 201 : 200).send({ quizAttempt: result.quizAttempt });
  });
}
