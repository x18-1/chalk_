import type { FastifyInstance } from 'fastify';

import type { AuthModule } from '../../auth/auth-module';
import { usersQuerySchema } from './schemas';
import type { UserAdministrationService } from './services/user-administration.service';

export function registerAdminRoutes(
  app: FastifyInstance,
  auth: AuthModule,
  administration: UserAdministrationService,
) {
  app.get('/admin/users', async (request) => {
    const user = await auth.requireAdmin(request);
    return administration.listUsers(user.id, usersQuerySchema.parse(request.query));
  });
}
