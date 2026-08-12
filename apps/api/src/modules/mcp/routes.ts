import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { McpManager, type McpServerConfig } from '@chalk/agent-runtime';

import type { AuthModule } from '../../auth/auth-module';
import { getDb } from '../../db/client';
import { createMcpServersDal } from '../../db/dal';
import { decrypt, encrypt } from '../../agent/credentials/encrypt';
import { closeUserRuntimes } from '../../agent/runtime-manager';
import { envSchema, httpUrlSchema } from '../../http/validation';
import { ApiError } from '../../http/errors';

const idParams = z.object({ id: z.string().uuid() });
const mcpSchema = z.object({
  name: z.string().trim().min(1).max(100),
  transport: z.enum(['stdio', 'sse', 'http']),
  command: z.string().trim().min(1).max(500).optional(),
  args: z.array(z.string().max(500)).max(100).optional(),
  url: httpUrlSchema.optional(),
  env: envSchema.optional(),
  enabled: z.boolean().default(true),
}).superRefine((value, context) => {
  if (value.transport === 'stdio' && !value.command) {
    context.addIssue({ code: 'custom', path: ['command'], message: 'stdio MCP requires command' });
  }
  if (value.transport !== 'stdio' && !value.url) {
    context.addIssue({ code: 'custom', path: ['url'], message: 'HTTP MCP requires url' });
  }
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  transport: z.enum(['stdio', 'sse', 'http']).optional(),
  command: z.string().trim().min(1).max(500).nullable().optional(),
  args: z.array(z.string().max(500)).max(100).optional(),
  url: httpUrlSchema.nullable().optional(),
  env: envSchema.nullable().optional(),
  enabled: z.boolean().optional(),
});

function publicServer(row: {
  id: string;
  name: string;
  transport: string;
  command: string | null;
  args: unknown;
  url: string | null;
  enabled: boolean;
  envEnc: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    command: row.command,
    args: row.args,
    url: row.url,
    enabled: row.enabled,
    configuredEnv: Boolean(row.envEnc),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function runtimeConfig(row: {
  id: string;
  name: string;
  transport: string;
  command: string | null;
  args: unknown;
  url: string | null;
  envEnc: string | null;
  enabled: boolean;
}): McpServerConfig {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as McpServerConfig['transport'],
    ...(row.command ? { command: row.command } : {}),
    ...(Array.isArray(row.args) ? { args: row.args.filter((arg): arg is string => typeof arg === 'string') } : {}),
    ...(row.url ? { url: row.url } : {}),
    ...(row.envEnc ? { env: JSON.parse(decrypt(row.envEnc)) as Record<string, string> } : {}),
    enabled: row.enabled,
  };
}

export function registerMcpRoutes(app: FastifyInstance, auth: AuthModule) {
  app.get('/mcp', async (request) => {
    const user = await auth.requireUser(request);
    const rows = await createMcpServersDal(getDb()).list(user.id);
    return { servers: rows.map(publicServer) };
  });

  app.post('/mcp', async (request, reply) => {
    const user = await auth.requireUser(request);
    const input = mcpSchema.parse(request.body);
    const row = await createMcpServersDal(getDb()).create(user.id, {
      name: input.name,
      transport: input.transport,
      command: input.command,
      args: input.args,
      url: input.url,
      enabled: input.enabled,
      ...(input.env ? { envEnc: encrypt(JSON.stringify(input.env)) } : {}),
    });
    await closeUserRuntimes(user.id);
    return reply.code(201).send({ server: publicServer(row) });
  });

  app.get('/mcp/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    return { server: publicServer(await createMcpServersDal(getDb()).getById(user.id, id)) };
  });

  app.patch('/mcp/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    const dal = createMcpServersDal(getDb());
    const existing = await dal.getById(user.id, id);
    const input = updateSchema.parse(request.body);
    const effectiveTransport = input.transport ?? existing.transport;
    const effectiveCommand = input.command === undefined ? existing.command : input.command;
    const effectiveUrl = input.url === undefined ? existing.url : input.url;
    if (effectiveTransport === 'stdio' && !effectiveCommand) {
      throw new ApiError(400, 'stdio MCP requires command', 'MCP_COMMAND_REQUIRED');
    }
    if (effectiveTransport !== 'stdio' && !effectiveUrl) {
      throw new ApiError(400, 'HTTP MCP requires url', 'MCP_URL_REQUIRED');
    }
    const { env, ...data } = input;
    const row = await dal.update(user.id, id, {
      ...data,
      ...(env !== undefined ? { envEnc: env ? encrypt(JSON.stringify(env)) : null } : {}),
    });
    await closeUserRuntimes(user.id);
    return { server: publicServer(row) };
  });

  app.delete('/mcp/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    await createMcpServersDal(getDb()).delete(user.id, id);
    await closeUserRuntimes(user.id);
    return { ok: true };
  });

  app.post('/mcp/:id/test', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = idParams.parse(request.params);
    const row = await createMcpServersDal(getDb()).getById(user.id, id);
    const manager = new McpManager();
    try {
      const tools = await manager.connect(runtimeConfig(row));
      return { status: manager.statuses()[0], tools };
    } finally {
      await manager.close();
    }
  });
}
