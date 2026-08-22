import type { FastifyInstance } from 'fastify';

import type { AuthModule } from '../../auth/auth-module';
import {
  mcpServerParamsSchema,
  mcpServerSchema,
  mcpServerUpdateSchema,
} from './schemas';
import type { McpServerService } from './services/mcp-server.service';

export function registerMcpRoutes(
  app: FastifyInstance,
  auth: AuthModule,
  mcp: McpServerService,
) {
  app.get('/mcp', async (request) => {
    const user = await auth.requireUser(request);
    return mcp.list(user.id);
  });

  app.post('/mcp', async (request, reply) => {
    const user = await auth.requireUser(request);
    const server = await mcp.create(user.id, mcpServerSchema.parse(request.body));
    return reply.code(201).send({ server });
  });

  app.get('/mcp/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = mcpServerParamsSchema.parse(request.params);
    return { server: await mcp.get(user.id, id) };
  });

  app.patch('/mcp/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = mcpServerParamsSchema.parse(request.params);
    const server = await mcp.update(
      user.id,
      id,
      mcpServerUpdateSchema.parse(request.body),
    );
    return { server };
  });

  app.delete('/mcp/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = mcpServerParamsSchema.parse(request.params);
    await mcp.delete(user.id, id);
    return { ok: true };
  });

  app.post('/mcp/:id/test', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = mcpServerParamsSchema.parse(request.params);
    return mcp.testConnection(user.id, id);
  });
}
