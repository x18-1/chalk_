import { randomBytes } from 'node:crypto';
import { access, mkdtemp, readFile, rm, unlink } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { eq } from 'drizzle-orm';
import { config as loadDotenv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

loadDotenv({
  path: resolve(fileURLToPath(new URL('../../../../.env', import.meta.url))),
  quiet: true,
});

import { buildApi } from '../../src/app';
import { loadConfig } from '../../src/config';
import { closeDb, getDb } from '../../src/db/client';
import { authUsers, conversations } from '../../src/db/schema';
import { closeRuntime, deleteSession } from '../../src/agent/runtime-manager';

const email = `mcp-api-${randomBytes(6).toString('hex')}@chalk.local`;
const password = `test-${randomBytes(12).toString('hex')}`;
const fixtureServerPath = resolve(
  fileURLToPath(new URL('../../../../packages/agent-runtime/tests/fixtures/mcp-server.mjs', import.meta.url)),
);

let sessionRoot: string;
let exitDirectory: string;
let exitFile: string;
let app: Awaited<ReturnType<typeof buildApi>>;
let userId: string;
let cookie: string;
let apiBaseUrl: string;
let providerBaseUrl: string;
let providerServer: Server;
let fixtureProviderId: string;
let proxyToolName: string | undefined;
const providerRequests: Array<Record<string, unknown>> = [];

function responseCookie(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.split(';', 1)[0] ?? '';
}

function sseChunk(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function streamFixtureResponse(
  response: import('node:http').ServerResponse,
  chunks: Array<Record<string, unknown>>,
) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
  });
  for (const chunk of chunks) response.write(sseChunk(chunk));
  response.end('data: [DONE]\n\n');
}

async function readJsonRequest(request: import('node:http').IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function createFixtureProviderServer() {
  return createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    const body = await readJsonRequest(request);
    providerRequests.push(body);
    const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
    const hasToolResult = messages.some((message) => message.role === 'tool');
    const latestUser = [...messages].reverse().find((message) => message.role === 'user');
    const userText = typeof latestUser?.content === 'string'
      ? latestUser.content
      : JSON.stringify(latestUser?.content ?? '');
    const id = `mcp-fixture-${providerRequests.length}`;

    if (userText.includes('调用 MCP 计算') && !hasToolResult) {
      if (!proxyToolName) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'MCP proxy tool was not registered' } }));
        return;
      }
      streamFixtureResponse(response, [
        {
          id,
          model: 'fixture-model',
          choices: [{
            index: 0,
            delta: {
              role: 'assistant',
              tool_calls: [{
                index: 0,
                id: 'mcp-proxy-call',
                type: 'function',
                function: {
                  name: proxyToolName,
                  arguments: JSON.stringify({
                    action: 'call',
                    tool: 'echo_math',
                    arguments: { left: 8, right: 13 },
                  }),
                },
              }],
            },
            finish_reason: null,
          }],
        },
        {
          id,
          model: 'fixture-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        },
      ]);
      return;
    }

    streamFixtureResponse(response, [
      {
        id,
        model: 'fixture-model',
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            content: hasToolResult ? 'MCP 工具已确认 8 + 13 = 21。' : '先写出一个已知关系。',
          },
          finish_reason: null,
        }],
      },
      {
        id,
        model: 'fixture-model',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    ]);
  });
}

async function consumeSse(response: Response) {
  if (!response.body) throw new Error('Missing SSE response body');
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const consume = (chunk: string) => {
    const match = chunk.match(/^event: ([^\n]+)\ndata: ([\s\S]+)$/);
    if (!match) return;
    events.push({ type: match[1]!, data: JSON.parse(match[2]!) as Record<string, unknown> });
  };
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) consume(chunk);
  }
  if (buffer.trim()) consume(buffer);
  return events;
}

async function streamConversation(conversationId: string, message: string) {
  const response = await fetch(`${apiBaseUrl}/chat/${conversationId}/stream`, {
    method: 'POST',
    headers: {
      cookie,
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: JSON.stringify({
      message,
      model: {
        providerId: fixtureProviderId,
        modelId: 'fixture-model',
        thinkingLevel: 'off',
      },
    }),
  });
  expect(response.status).toBe(200);
  return consumeSse(response);
}

describe('MCP through the API composition root', () => {
  beforeAll(async () => {
    providerServer = createFixtureProviderServer();
    await new Promise<void>((resolveListen) => providerServer.listen(0, '127.0.0.1', resolveListen));
    providerBaseUrl = `http://127.0.0.1:${(providerServer.address() as AddressInfo).port}/v1`;
    sessionRoot = await mkdtemp(join(tmpdir(), 'chalk-mcp-api-session-'));
    exitDirectory = await mkdtemp(join(tmpdir(), 'chalk-mcp-api-exit-'));
    exitFile = join(exitDirectory, 'fixture-exited');
    process.env.DEV_USER_EMAIL = email;
    process.env.DEV_USER_PASSWORD = password;
    process.env.SESSIONS_ROOT = join(sessionRoot, 'sessions');
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    app = await buildApi({
      config: loadConfig({
        NODE_ENV: 'test',
        API_HOST: '127.0.0.1',
        API_PORT: '3012',
        WEB_ORIGIN: 'http://localhost:3000',
        SESSION_COOKIE_NAME: 'chalk_mcp_test_session',
        SESSION_COOKIE_SECURE: 'false',
        SESSION_TTL_DAYS: '1',
      }),
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    apiBaseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    cookie = responseCookie(login.headers['set-cookie']);
    userId = login.json().user.id;

    const provider = await app.inject({
      method: 'POST',
      url: '/providers/custom',
      headers: { cookie },
      payload: {
        name: 'MCP local fixture',
        baseUrl: providerBaseUrl,
        apiKey: 'fixture-key',
        models: [{
          id: 'fixture-model',
          name: 'Fixture Model',
          reasoning: false,
          input: ['text'],
          contextWindow: 128_000,
          maxTokens: 8_192,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }],
      },
    });
    expect(provider.statusCode).toBe(201);
    fixtureProviderId = provider.json().provider.id;
  });

  afterAll(async () => {
    const db = getDb();
    if (userId) {
      const rows = await db.select({ id: conversations.id, sessionId: conversations.sessionId })
        .from(conversations)
        .where(eq(conversations.userId, userId));
      await Promise.all(rows.map(async (row) => {
        await closeRuntime(row.id).catch(() => undefined);
        await deleteSession(userId, row.sessionId).catch(() => undefined);
      }));
      await db.delete(authUsers).where(eq(authUsers.id, userId));
    }
    await app.close();
    await new Promise<void>((resolveClose, reject) => {
      providerServer.close((error) => error ? reject(error) : resolveClose());
    });
    await closeDb();
    await rm(sessionRoot, { recursive: true, force: true });
    await rm(exitDirectory, { recursive: true, force: true });
  });

  it('discovers a stdio MCP server, invokes its proxy tool in chat, and cleans up the child', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { cookie },
      payload: {
        name: 'math-echo',
        transport: 'stdio',
        command: process.execPath,
        args: [fixtureServerPath],
        env: { MCP_FIXTURE_EXIT_FILE: exitFile },
      },
    });
    expect(created.statusCode).toBe(201);
    const serverId = created.json().server.id as string;

    const discovered = await app.inject({
      method: 'POST',
      url: `/mcp/${serverId}/test`,
      headers: { cookie },
    });
    expect(discovered.statusCode).toBe(200);
    expect(discovered.json().status).toMatchObject({
      id: serverId,
      state: 'connected',
      toolCount: 1,
    });
    expect(JSON.stringify(discovered.json().tools)).toContain('echo_math');
    await expect(access(exitFile)).resolves.toBeUndefined();
    await expect(readFile(exitFile, 'utf8')).resolves.toBe('closed');
    await unlink(exitFile);

    const listed = await app.inject({ method: 'GET', url: '/tools', headers: { cookie } });
    expect(listed.statusCode).toBe(200);
    const proxy = (listed.json().tools as Array<{ name: string; source: string }>)
      .find((tool) => tool.source === 'mcp');
    expect(proxy).toBeDefined();
    proxyToolName = proxy!.name;

    const conversationResponse = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { cookie },
      payload: {},
    });
    expect(conversationResponse.statusCode).toBe(201);
    const conversationId = conversationResponse.json().conversation.id as string;

    const events = await streamConversation(conversationId, '请调用 MCP 计算 8 加 13');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'tool_started',
        data: expect.objectContaining({
          toolCallId: 'mcp-proxy-call',
          toolName: proxyToolName,
        }),
      }),
      expect.objectContaining({
        type: 'tool_finished',
        data: expect.objectContaining({
          toolCallId: 'mcp-proxy-call',
          toolName: proxyToolName,
          isError: false,
        }),
      }),
      expect.objectContaining({ type: 'result' }),
    ]));

    const history = await app.inject({
      method: 'GET',
      url: `/chat/${conversationId}/messages`,
      headers: { cookie },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'toolResult',
        toolCallId: 'mcp-proxy-call',
        toolName: proxyToolName,
        isError: false,
        content: [{ type: 'text', text: '8 + 13 = 21' }],
      }),
    ]));

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/mcp/${serverId}`,
      headers: { cookie },
    });
    expect(deleted.statusCode).toBe(200);

    await expect(access(exitFile)).resolves.toBeUndefined();
    await expect(readFile(exitFile, 'utf8')).resolves.toBe('closed');

    const toolsAfterDelete = await app.inject({ method: 'GET', url: '/tools', headers: { cookie } });
    expect(
      (toolsAfterDelete.json().tools as Array<{ source: string }>)
        .filter((tool) => tool.source === 'mcp'),
    ).toEqual([]);
  });

  it('does not expose or spawn a disabled MCP server', async () => {
    const disabledExitFile = join(exitDirectory, 'disabled-exited');
    const created = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { cookie },
      payload: {
        name: 'disabled-echo',
        transport: 'stdio',
        command: process.execPath,
        args: [fixtureServerPath],
        env: { MCP_FIXTURE_EXIT_FILE: disabledExitFile },
        enabled: false,
      },
    });
    expect(created.statusCode).toBe(201);
    const serverId = created.json().server.id as string;

    const listed = await app.inject({ method: 'GET', url: '/tools', headers: { cookie } });
    expect(listed.statusCode).toBe(200);
    expect(
      (listed.json().tools as Array<{ source: string }>)
        .filter((tool) => tool.source === 'mcp'),
    ).toEqual([]);

    const discovered = await app.inject({
      method: 'POST',
      url: `/mcp/${serverId}/test`,
      headers: { cookie },
    });
    expect(discovered.statusCode).toBe(200);
    expect(discovered.json().status).toMatchObject({
      id: serverId,
      state: 'disconnected',
      toolCount: 0,
    });
    expect(discovered.json().tools).toEqual([]);
    await expect(access(disabledExitFile)).rejects.toMatchObject({ code: 'ENOENT' });

    const conversationResponse = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { cookie },
      payload: {},
    });
    expect(conversationResponse.statusCode).toBe(201);
    const conversationId = conversationResponse.json().conversation.id as string;
    await streamConversation(conversationId, '不要调用任何 MCP 工具');

    const advertised = JSON.stringify(providerRequests.at(-1)?.tools ?? []);
    expect(advertised).not.toContain('mcp__');

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/mcp/${serverId}`,
      headers: { cookie },
    });
    expect(deleted.statusCode).toBe(200);
    await expect(access(disabledExitFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns a structured failure when MCP test cannot connect', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { cookie },
      payload: {
        name: 'missing-echo',
        transport: 'stdio',
        command: resolve(exitDirectory, 'does-not-exist'),
      },
    });
    expect(created.statusCode).toBe(201);
    const serverId = created.json().server.id as string;

    const discovered = await app.inject({
      method: 'POST',
      url: `/mcp/${serverId}/test`,
      headers: { cookie },
    });
    expect(discovered.statusCode).toBe(502);
    expect(discovered.json()).toMatchObject({
      code: 'MCP_CONNECT_FAILED',
    });
    expect(discovered.json().error).toEqual(expect.any(String));
    expect(discovered.json().error.length).toBeGreaterThan(0);

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/mcp/${serverId}`,
      headers: { cookie },
    });
    expect(deleted.statusCode).toBe(200);
  });
});
