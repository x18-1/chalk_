import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { config as loadDotenv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hash } from 'bcryptjs';

loadDotenv({ path: join(process.cwd(), '../../.env ') });

import { buildApi } from '../../src/app';
import { loadConfig } from '../../src/config';
import { closeDb, getDb } from '../../src/db/client';
import { createAttachmentsDal, createSubagentRunsDal } from '../../src/db/dal';
import { OwnershipError } from '../../src/db/errors';
import { authUsers, conversations } from '../../src/db/schema';
import {
  closeRuntime,
  createSession,
  deleteSession,
  getOrCreateRuntime,
} from '../../src/agent/runtime-manager';

const email = `api-test-${randomBytes(6).toString('hex')}@chalk.local`;
const password = `test-${randomBytes(12).toString('hex')}`;
let sessionRoot: string;
let app: Awaited<ReturnType<typeof buildApi>>;
let userId: string;
let cookie: string;
let apiBaseUrl: string;
let providerBaseUrl: string;
let providerServer: Server;
let fixtureProviderId: string;
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
    const id = `fixture-${providerRequests.length}`;

    if (userText.includes('Provider 错误分类')) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'fixture provider rejected the request' } }));
      return;
    }

    if (userText.includes('审批链路') && !hasToolResult) {
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
                id: 'http-approval-call',
                type: 'function',
                function: {
                  name: 'make_hint_ladder',
                  arguments: '{"stuckAt":"列出已知条件","level":1}',
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
            reasoning_content: hasToolResult ? '先确认工具结果，再给下一步。' : '先检查学生给出的条件。',
          },
          finish_reason: null,
        }],
      },
      {
        id,
        model: 'fixture-model',
        choices: [{
          index: 0,
          delta: { content: hasToolResult ? '工具已确认，先圈出题目中的重复对象。' : '先写出一个已知关系。' },
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

async function consumeSse(
  response: Response,
  onEvent?: (type: string, data: Record<string, unknown>) => void,
) {
  if (!response.body) throw new Error('Missing SSE response body');
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const consume = (chunk: string) => {
    const match = chunk.match(/^event: ([^\n]+)\ndata: ([\s\S]+)$/);
    if (!match) return;
    const event = { type: match[1]!, data: JSON.parse(match[2]!) as Record<string, unknown> };
    events.push(event);
    onEvent?.(event.type, event.data);
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

async function streamConversation(
  conversationId: string,
  message: string,
  onEvent?: (type: string, data: Record<string, unknown>) => void,
) {
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
  return consumeSse(response, onEvent);
}

describe('API auth and chat interface', () => {
  beforeAll(async () => {
    providerServer = createFixtureProviderServer();
    await new Promise<void>((resolve) => providerServer.listen(0, '127.0.0.1', resolve));
    providerBaseUrl = `http://127.0.0.1:${(providerServer.address() as AddressInfo).port}/v1`;
    sessionRoot = await mkdtemp(join(tmpdir(), 'chalk-api-test-'));
    process.env.DEV_USER_EMAIL = email;
    process.env.DEV_USER_PASSWORD = password;
    process.env.SESSIONS_ROOT = join(sessionRoot, 'sessions');
    process.env.SKILLS_DIRS = join(process.cwd(), 'tests/fixtures/skills');
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    app = await buildApi({
      config: loadConfig({
        NODE_ENV: 'test',
        API_HOST: '127.0.0.1',
        API_PORT: '3011',
        WEB_ORIGIN: 'http://localhost:3000',
        SESSION_COOKIE_NAME: 'chalk_test_session',
        SESSION_COOKIE_SECURE: 'false',
        SESSION_TTL_DAYS: '1',
      }),
    });
    await app.listen({ host: '127.0.0.1', port: 0 });
    apiBaseUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    const db = getDb();
    if (userId) {
      const rows = await db.select({ id: conversations.id, sessionId: conversations.sessionId })
        .from(conversations)
        .where(eq(conversations.userId, userId));
      await Promise.all(rows.map((row) => deleteSession(userId, row.sessionId).catch(() => undefined)));
      await db.delete(authUsers).where(eq(authUsers.id, userId));
    }
    await app.close();
    await new Promise<void>((resolve, reject) => providerServer.close((error) => error ? reject(error) : resolve()));
    await closeDb();
    await rm(sessionRoot, { recursive: true, force: true });
  });

  it('fails closed without a session cookie', async () => {
    const response = await app.inject({ method: 'GET', url: '/chat' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('logs in, exposes the session, and scopes conversations to the owner', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    cookie = responseCookie(login.headers['set-cookie']);
    expect(cookie).toContain('chalk_test_session=');
    userId = login.json().user.id;

    const session = await app.inject({ method: 'GET', url: '/auth/session', headers: { cookie } });
    expect(session.statusCode).toBe(200);
    expect(session.json().user.id).toBe(userId);

    const created = await app.inject({ method: 'POST', url: '/chat', headers: { cookie }, payload: {} });
    expect(created.statusCode).toBe(201);
    const conversationId = created.json().conversation.id as string;

    const messages = await app.inject({ method: 'GET', url: `/chat/${conversationId}/messages`, headers: { cookie } });
    expect(messages.statusCode).toBe(200);
    expect(messages.json().messages).toEqual([]);

    const emptyJsonBody = await app.inject({
      method: 'DELETE',
      url: `/chat/${conversationId}`,
      headers: { cookie, 'content-type': 'application/json' },
    });
    expect(emptyJsonBody.statusCode).toBe(400);
    expect(emptyJsonBody.json()).toMatchObject({ code: 'INVALID_REQUEST' });

    const missingSession = await app.inject({ method: 'POST', url: '/chat', headers: { cookie }, payload: {} });
    expect(missingSession.statusCode).toBe(201);
    await deleteSession(userId, missingSession.json().conversation.sessionId);
    const missingSessionMessages = await app.inject({
      method: 'GET',
      url: `/chat/${missingSession.json().conversation.id}/messages`,
      headers: { cookie },
    });
    expect(missingSessionMessages.statusCode).toBe(404);
    expect(missingSessionMessages.json()).toMatchObject({ code: 'SESSION_NOT_FOUND' });

    const foreign = await app.inject({ method: 'GET', url: `/chat/${randomBytes(16).toString('hex')}`, headers: { cookie } });
    expect(foreign.statusCode).toBe(400);

    const missing = await app.inject({ method: 'GET', url: `/chat/00000000-0000-4000-8000-000000000000`, headers: { cookie } });
    expect(missing.statusCode).toBe(404);

    const foreignUser = (await getDb().insert(authUsers).values({ email: `foreign-${randomBytes(6).toString('hex')}@chalk.local` }).returning())[0]!;
    const foreignSession = await createSession(foreignUser.id);
    const foreignConversation = (await getDb().insert(conversations).values({
      userId: foreignUser.id,
      sessionId: foreignSession.descriptor.id,
      sessionFilePath: foreignSession.descriptor.path,
    }).returning())[0]!;
    const forbidden = await app.inject({ method: 'GET', url: `/chat/${foreignConversation.id}`, headers: { cookie } });
    expect(forbidden.statusCode).toBe(404);
    await expect(createAttachmentsDal(getDb()).create(userId, {
      conversationId: foreignConversation.id,
      fileKey: `${userId}/foreign-attachment`,
      filename: 'foreign.png',
      contentType: 'image/png',
      size: 1,
    })).rejects.toBeInstanceOf(OwnershipError);
    await expect(createSubagentRunsDal(getDb()).start(userId, {
      conversationId: foreignConversation.id,
      parentSessionId: 'parent',
      childSessionId: 'child',
      timeoutMs: 1_000,
    })).rejects.toBeInstanceOf(OwnershipError);
    const mismatchedSessionConversation = (await getDb().insert(conversations).values({
      userId,
      sessionId: foreignSession.descriptor.id,
      sessionFilePath: foreignSession.descriptor.path,
    }).returning())[0]!;
    const mismatchedSessionMessages = await app.inject({
      method: 'GET',
      url: `/chat/${mismatchedSessionConversation.id}/messages`,
      headers: { cookie },
    });
    expect(mismatchedSessionMessages.statusCode).toBe(404);
    expect(mismatchedSessionMessages.json()).toMatchObject({ code: 'SESSION_NOT_FOUND' });
    await getDb().delete(authUsers).where(eq(authUsers.id, foreignUser.id));
    await deleteSession(foreignUser.id, foreignSession.descriptor.id);
  });

  it('rejects a disallowed browser origin before mutating routes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { cookie, origin: 'https://attacker.example' },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' });
  });

  it('allows configured browser origins to preflight every mutating method', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await app.inject({
        method: 'OPTIONS',
        url: '/settings/model',
        headers: {
          origin: 'http://localhost:3000',
          'access-control-request-method': method,
          'access-control-request-headers': 'content-type',
        },
      });
      expect(response.statusCode).toBe(204);
      expect(response.headers['access-control-allow-origin']).toBe('http://localhost:3000');
      expect(response.headers['access-control-allow-methods']).toContain(method);
    }
  });

  it('only advertises credential removal for a user-stored credential', async () => {
    const saved = await app.inject({
      method: 'PUT',
      url: '/providers/anthropic/credential',
      headers: { cookie },
      payload: { apiKey: 'test-stored-anthropic-key' },
    });
    expect(saved.statusCode).toBe(200);

    const configured = await app.inject({ method: 'GET', url: '/providers', headers: { cookie } });
    expect(configured.statusCode).toBe(200);
    expect(configured.json().providers).toContainEqual(expect.objectContaining({
      id: 'anthropic',
      configured: true,
      canRemoveCredential: true,
    }));

    const removed = await app.inject({
      method: 'DELETE',
      url: '/providers/anthropic/credential',
      headers: { cookie },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ providerId: 'anthropic', canRemoveCredential: false });

    const afterRemoval = await app.inject({ method: 'GET', url: '/providers', headers: { cookie } });
    expect(afterRemoval.statusCode).toBe(200);
    expect(afterRemoval.json().providers).toContainEqual(expect.objectContaining({
      id: 'anthropic',
      canRemoveCredential: false,
    }));
  });

  it('persists a supported thinking level and rejects an unsupported one', async () => {
    const customModel = {
      id: 'test-chat-model',
      name: 'Test Chat Model',
      reasoning: false,
      input: ['text', 'image'],
      contextWindow: 128_000,
      maxTokens: 8_192,
      cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 },
    };
    const created = await app.inject({
      method: 'POST',
      url: '/providers/custom',
      headers: { cookie },
      payload: {
        name: 'Test OpenAI-compatible provider',
        baseUrl: 'https://models.example.test/v1',
        apiKey: 'test-api-key',
        models: [customModel],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().provider).toMatchObject({
      name: 'Test OpenAI-compatible provider',
      configured: true,
      canRemoveCredential: true,
      models: [customModel],
    });
    expect(JSON.stringify(created.json())).not.toContain('test-api-key');
    const providerId = created.json().provider.id as string;

    const customProviders = await app.inject({ method: 'GET', url: '/providers/custom', headers: { cookie } });
    expect(customProviders.statusCode).toBe(200);
    expect(customProviders.json().providers).toContainEqual(expect.objectContaining({
      id: providerId,
      canRemoveCredential: true,
      models: [customModel],
    }));

    const models = await app.inject({ method: 'GET', url: `/models?provider=${providerId}`, headers: { cookie } });
    expect(models.statusCode).toBe(200);
    expect(models.json().models).toContainEqual(expect.objectContaining({
      ...customModel,
      providerId,
      thinkingLevels: ['off'],
    }));

    const saved = await app.inject({
      method: 'PUT',
      url: '/settings/model',
      headers: { cookie },
      payload: { providerId, modelId: 'test-chat-model', thinkingLevel: 'off' },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().defaultModel).toEqual({
      providerId,
      modelId: 'test-chat-model',
      thinkingLevel: 'off',
    });

    const settings = await app.inject({ method: 'GET', url: '/settings', headers: { cookie } });
    expect(settings.statusCode).toBe(200);
    expect(settings.json().defaultModel).toEqual(saved.json().defaultModel);

    const conversationResponse = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { cookie },
      payload: {},
    });
    const conversation = conversationResponse.json().conversation;
    const runtime = await getOrCreateRuntime(userId, conversation);
    expect(runtime.model).toEqual(saved.json().defaultModel);
    await closeRuntime(conversation.id);

    const unsupported = await app.inject({
      method: 'PUT',
      url: '/settings/model',
      headers: { cookie },
      payload: { providerId, modelId: 'test-chat-model', thinkingLevel: 'high' },
    });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json()).toMatchObject({ code: 'UNSUPPORTED_THINKING_LEVEL' });
  });

  it('persists owner-scoped Skill and tool settings', async () => {
    const skills = await app.inject({ method: 'GET', url: '/skills', headers: { cookie } });
    expect(skills.statusCode).toBe(200);
    expect(skills.json().skills).toContainEqual(expect.objectContaining({
      name: 'geometry-coach',
      enabled: true,
    }));

    const disabledSkill = await app.inject({
      method: 'PATCH',
      url: '/skills',
      headers: { cookie },
      payload: { skillName: 'geometry-coach', enabled: false },
    });
    expect(disabledSkill.statusCode).toBe(200);

    const updatedTool = await app.inject({
      method: 'PATCH',
      url: '/tools',
      headers: { cookie },
      payload: {
        toolName: 'inspect_problem_structure',
        enabled: false,
        approval: 'always',
      },
    });
    expect(updatedTool.statusCode).toBe(200);

    const persistedSkills = await app.inject({ method: 'GET', url: '/skills', headers: { cookie } });
    expect(persistedSkills.json().skills).toContainEqual(expect.objectContaining({
      name: 'geometry-coach',
      enabled: false,
    }));
    const persistedTools = await app.inject({ method: 'GET', url: '/tools', headers: { cookie } });
    expect(persistedTools.json().tools).toContainEqual(expect.objectContaining({
      name: 'inspect_problem_structure',
      enabled: false,
      approval: 'always',
    }));

    const foreignEmail = `settings-${randomBytes(6).toString('hex')}@chalk.local`;
    const foreignPassword = `settings-${randomBytes(12).toString('hex')}`;
    const foreignUser = (await getDb().insert(authUsers).values({
      email: foreignEmail,
      passwordHash: await hash(foreignPassword, 4),
    }).returning())[0]!;
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: foreignEmail, password: foreignPassword },
      });
      const foreignCookie = responseCookie(login.headers['set-cookie']);
      const foreignSkills = await app.inject({
        method: 'GET',
        url: '/skills',
        headers: { cookie: foreignCookie },
      });
      expect(foreignSkills.json().skills).toContainEqual(expect.objectContaining({
        name: 'geometry-coach',
        enabled: true,
      }));
      const foreignTools = await app.inject({
        method: 'GET',
        url: '/tools',
        headers: { cookie: foreignCookie },
      });
      expect(foreignTools.json().tools).toContainEqual(expect.objectContaining({
        name: 'inspect_problem_structure',
        enabled: true,
        approval: 'default',
      }));
    } finally {
      await getDb().delete(authUsers).where(eq(authUsers.id, foreignUser.id));
    }
  });

  it('applies Skill and approval settings to the real Chat stream and durable history', async () => {
    const provider = await app.inject({
      method: 'POST',
      url: '/providers/custom',
      headers: { cookie },
      payload: {
        name: 'Local deterministic fixture',
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

    const conversationResponse = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { cookie },
      payload: {},
    });
    const conversationId = conversationResponse.json().conversation.id as string;

    const enabled = await app.inject({
      method: 'PATCH',
      url: '/skills',
      headers: { cookie },
      payload: { skillName: 'geometry-coach', enabled: true },
    });
    expect(enabled.statusCode).toBe(200);
    await streamConversation(conversationId, '检查启用的 Skill prompt');
    const enabledPrompt = (providerRequests.at(-1)?.messages as Array<Record<string, unknown>>)[0]?.content;
    expect(String(enabledPrompt)).toContain('geometry-coach');
    expect(String(enabledPrompt)).toContain('Guide geometry learners to name known relationships');

    const disabled = await app.inject({
      method: 'PATCH',
      url: '/skills',
      headers: { cookie },
      payload: { skillName: 'geometry-coach', enabled: false },
    });
    expect(disabled.statusCode).toBe(200);
    await streamConversation(conversationId, '检查停用的 Skill prompt');
    const disabledPrompt = (providerRequests.at(-1)?.messages as Array<Record<string, unknown>>)[0]?.content;
    expect(String(disabledPrompt)).not.toContain('geometry-coach');
    expect(String(disabledPrompt)).not.toContain('Guide geometry learners to name known relationships');

    const approvalMode = await app.inject({
      method: 'PATCH',
      url: '/tools',
      headers: { cookie },
      payload: {
        toolName: 'make_hint_ladder',
        enabled: true,
        approval: 'always',
      },
    });
    expect(approvalMode.statusCode).toBe(200);

    let approvalResponse: Promise<Response> | undefined;
    const events = await streamConversation(conversationId, '验证审批链路', (type, data) => {
      if (type !== 'tool_pending') return;
      approvalResponse = fetch(`${apiBaseUrl}/chat/${conversationId}/approve`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ toolCallId: data.toolCallId, approved: true }),
      });
    });
    expect(approvalResponse).toBeDefined();
    expect((await approvalResponse!).status).toBe(200);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool_pending' }),
      expect.objectContaining({ type: 'tool_finished' }),
      expect.objectContaining({ type: 'thinking_delta' }),
      expect.objectContaining({ type: 'result' }),
    ]));

    const repeatedDecision = await app.inject({
      method: 'POST',
      url: `/chat/${conversationId}/approve`,
      headers: { cookie },
      payload: { toolCallId: 'http-approval-call', approved: false },
    });
    expect(repeatedDecision.statusCode).toBe(409);
    expect(repeatedDecision.json()).toMatchObject({
      code: 'TOOL_APPROVAL_ALREADY_DECIDED',
    });

    const history = await app.inject({
      method: 'GET',
      url: `/chat/${conversationId}/messages`,
      headers: { cookie },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: expect.arrayContaining([expect.objectContaining({
          type: 'toolCall',
          id: 'http-approval-call',
        })]),
      }),
      expect.objectContaining({
        role: 'toolResult',
        toolCallId: 'http-approval-call',
        isError: false,
      }),
      expect.objectContaining({
        role: 'assistant',
        content: expect.arrayContaining([expect.objectContaining({
          type: 'thinking',
          thinking: '先确认工具结果，再给下一步。',
        })]),
      }),
    ]));

    const failureEvents = await streamConversation(conversationId, '验证 Provider 错误分类');
    expect(failureEvents).toContainEqual(expect.objectContaining({
      type: 'error',
      data: expect.objectContaining({
        category: 'provider',
        code: 'STREAM_PROVIDER_ERROR',
        retryable: true,
      }),
    }));
  });

  it('rejects credential-bearing MCP URLs at the API seam', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { cookie },
      payload: {
        name: 'unsafe',
        transport: 'http',
        url: 'https://user:password@example.com/mcp',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
