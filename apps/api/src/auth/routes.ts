import type { FastifyInstance } from 'fastify';

import type { AuthModule } from './auth-module';
import type { AuthService } from './auth.service';
import { credentialsSchema } from './schemas';

export function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthModule,
  service: AuthService,
) {
  app.post('/auth/login', async (request, reply) => {
    const session = await service.login(credentialsSchema.parse(request.body));
    if (!session) {
      return reply.code(401).send({
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS',
      });
    }
    auth.setSessionCookie(reply, session.token, session.expires);
    return { user: session.user };
  });

  app.get('/auth/session', async (request) => ({
    user: await auth.optionalUser(request),
  }));

  app.post('/auth/logout', async (request, reply) => {
    await auth.logout(request);
    auth.clearSessionCookie(reply);
    return { ok: true };
  });
}
