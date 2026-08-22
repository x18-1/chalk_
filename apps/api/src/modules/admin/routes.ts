import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AuthModule } from '../../auth/auth-module';
import { getDb } from '../../db/client';
import { createAuthUsersDal } from '../../db/dal';

const usersQuery = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(['admin', 'user']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function registerAdminRoutes(app: FastifyInstance, auth: AuthModule) {
  app.get('/admin/users', async (request) => {
    const user = await auth.requireAdmin(request);
    const query = usersQuery.parse(request.query);
    return createAuthUsersDal(getDb()).listForAdmin(user.id, {
      query: query.q,
      role: query.role,
      limit: query.limit,
      offset: query.offset,
    });
  });
}
