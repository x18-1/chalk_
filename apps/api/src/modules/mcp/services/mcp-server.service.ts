import { McpManager, type McpServerConfig } from '@chalk/agent-runtime';

import { closeUserRuntimes } from '../../../agent/runtime-manager';
import type { Database } from '../../../db/client';
import { createMcpServersDal } from '../../../db/dal';
import { ApiError } from '../../../http/errors';
import { decrypt, encrypt } from '../../../security/credential-encryption';
import type { McpServerInput, McpServerUpdateInput } from '../schemas';

type McpServerRow = {
  id: string;
  name: string;
  transport: string;
  command: string | null;
  args: unknown;
  url: string | null;
  enabled: boolean;
  envEnc: string | null;
  headersEnc: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function publicServer(row: McpServerRow) {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    command: row.command,
    args: row.args,
    url: row.url,
    enabled: row.enabled,
    configuredEnv: Boolean(row.envEnc),
    configuredBearer: Boolean(row.headersEnc),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function runtimeConfig(row: McpServerRow): McpServerConfig {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as McpServerConfig['transport'],
    ...(row.command ? { command: row.command } : {}),
    ...(Array.isArray(row.args)
      ? { args: row.args.filter((arg): arg is string => typeof arg === 'string') }
      : {}),
    ...(row.url ? { url: row.url } : {}),
    ...(row.envEnc
      ? { env: JSON.parse(decrypt(row.envEnc)) as Record<string, string> }
      : {}),
    ...(row.headersEnc
      ? { headers: JSON.parse(decrypt(row.headersEnc)) as Record<string, string> }
      : {}),
    enabled: row.enabled,
  };
}

export class McpServerService {
  private readonly servers;

  constructor(db: Database) {
    this.servers = createMcpServersDal(db);
  }

  async list(userId: string, includePrivilegedTransports = true) {
    const rows = await this.servers.list(userId);
    return {
      servers: rows
        .filter((row) => includePrivilegedTransports || row.transport === 'http')
        .map(publicServer),
    };
  }

  async create(userId: string, input: McpServerInput) {
    const row = await this.servers.create(userId, {
      name: input.name,
      transport: input.transport,
      command: input.command,
      args: input.args,
      url: input.url,
      enabled: input.enabled,
      ...(input.env ? { envEnc: encrypt(JSON.stringify(input.env)) } : {}),
      ...(input.bearerToken ? { headersEnc: encrypt(JSON.stringify({ Authorization: `Bearer ${input.bearerToken}` })) } : {}),
    });
    await closeUserRuntimes(userId);
    return publicServer(row);
  }

  async get(userId: string, serverId: string) {
    return publicServer(await this.servers.getById(userId, serverId));
  }

  async update(
    userId: string,
    serverId: string,
    input: McpServerUpdateInput,
  ) {
    const existing = await this.servers.getById(userId, serverId);
    const effectiveTransport = input.transport ?? existing.transport;
    const effectiveCommand = input.command === undefined
      ? existing.command
      : input.command;
    const effectiveUrl = input.url === undefined ? existing.url : input.url;
    if (effectiveTransport === 'stdio' && !effectiveCommand) {
      throw new ApiError(400, 'stdio MCP requires command', 'MCP_COMMAND_REQUIRED');
    }
    if (effectiveTransport !== 'stdio' && !effectiveUrl) {
      throw new ApiError(400, 'HTTP MCP requires url', 'MCP_URL_REQUIRED');
    }
    const { env, bearerToken, ...data } = input;
    const row = await this.servers.update(userId, serverId, {
      ...data,
      ...(env !== undefined
        ? { envEnc: env ? encrypt(JSON.stringify(env)) : null }
        : {}),
      ...(bearerToken !== undefined
        ? { headersEnc: bearerToken ? encrypt(JSON.stringify({ Authorization: `Bearer ${bearerToken}` })) : null }
        : {}),
    });
    await closeUserRuntimes(userId);
    return publicServer(row);
  }

  async delete(userId: string, serverId: string) {
    await this.servers.delete(userId, serverId);
    await closeUserRuntimes(userId);
  }

  async testConnection(userId: string, serverId: string) {
    const row = await this.servers.getById(userId, serverId);
    const manager = new McpManager();
    try {
      const tools = await manager.connect(runtimeConfig(row));
      return { status: manager.statuses()[0], tools };
    } catch (error) {
      throw new ApiError(
        502,
        error instanceof Error ? error.message : 'MCP server failed to connect',
        'MCP_CONNECT_FAILED',
      );
    } finally {
      await manager.close();
    }
  }
}
