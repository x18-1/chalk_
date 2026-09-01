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
    return mcp.list(user.id, false);
  });

  app.post('/mcp', async (request, reply) => {
    const user = await auth.requireUser(request);
    const input = mcpServerSchema.parse(request.body);
    if (input.transport !== 'http') await auth.requireAdmin(request);
    const server = await mcp.create(user.id, input);
    return reply.code(201).send({ server });
  });

  app.get('/mcp/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = mcpServerParamsSchema.parse(request.params);
    const server = await mcp.get(user.id, id);
    if (server.transport !== 'http') await auth.requireAdmin(request);
    return { server };
  });

  app.patch('/mcp/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = mcpServerParamsSchema.parse(request.params);
    const input = mcpServerUpdateSchema.parse(request.body);
    const existing = await mcp.get(user.id, id);
    if (existing.transport !== 'http' || (input.transport && input.transport !== 'http')) {
      await auth.requireAdmin(request);
    }
    const server = await mcp.update(
      user.id,
      id,
      input,
    );
    return { server };
  });

  app.delete('/mcp/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = mcpServerParamsSchema.parse(request.params);
    const existing = await mcp.get(user.id, id);
    if (existing.transport !== 'http') await auth.requireAdmin(request);
    await mcp.delete(user.id, id);
    return { ok: true };
  });

  app.post('/mcp/:id/test', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = mcpServerParamsSchema.parse(request.params);
    const existing = await mcp.get(user.id, id);
    if (existing.transport !== 'http') await auth.requireAdmin(request);
    return mcp.testConnection(user.id, id);
  });
}
