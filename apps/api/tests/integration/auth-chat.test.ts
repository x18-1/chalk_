import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApi } from '../../src/app';
import { loadConfig } from '../../src/config';
import { closeDb, getDb } from '../../src/db/client';
import {
  createAgentRunObservationsDal,
  createAttachmentsDal,
  createSubagentRunsDal,
} from '../../src/db/dal';
import { OwnershipError } from '../../src/db/errors';
import { authUsers, conversations } from '../../src/db/schema';
import {
  closeRuntime,
  createSession,
  deleteSession,
  getOrCreateRuntime,
  openSession,
} from '../../src/agent/runtime-manager';

const developmentAdmin = { email: 'admin@qq.com', password: 'admin123' };
const developmentUser = { email: 'user@qq.com', password: 'user123' };
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
    const latestUserIndex = messages.reduce(
      (latest, message, index) => message.role === 'user' ? index : latest,
      -1,
    );
    const hasToolResult = latestUserIndex >= 0
      && messages.slice(latestUserIndex + 1).some((message) => message.role === 'tool');
    const latestUser = latestUserIndex >= 0 ? messages[latestUserIndex] : undefined;
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
                  name: 'rename_current_conversation',
                  arguments: '{"title":"审批后的学习会话"}',
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
    process.env.DEV_ADMIN_EMAIL = developmentAdmin.email;
    process.env.DEV_ADMIN_PASSWORD = developmentAdmin.password;
    process.env.DEV_USER_EMAIL = developmentUser.email;
    process.env.DEV_USER_PASSWORD = developmentUser.password;
    process.env.SESSIONS_ROOT = join(sessionRoot, 'sessions');
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

  it('returns development roles and protects admin telemetry routes', async () => {
    const adminLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: developmentAdmin.email, password: developmentAdmin.password },
    });
    expect(adminLogin.statusCode).toBe(200);
    expect(adminLogin.json().user).toMatchObject({
      email: developmentAdmin.email,
      role: 'admin',
    });
    const adminCookie = responseCookie(adminLogin.headers['set-cookie']);

    const adminSession = await app.inject({
      method: 'GET',
      url: '/auth/session',
      headers: { cookie: adminCookie },
    });
    expect(adminSession.json().user).toMatchObject({ role: 'admin' });
    const adminTelemetry = await app.inject({
      method: 'GET',
      url: '/telemetry/spans',
      headers: { cookie: adminCookie },
    });
    expect(adminTelemetry.statusCode).toBe(200);

    const userLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: developmentUser.email, password: developmentUser.password },
    });
    expect(userLogin.statusCode).toBe(200);
    expect(userLogin.json().user).toMatchObject({
      email: developmentUser.email,
      role: 'user',
    });
    const userTelemetry = await app.inject({
      method: 'GET',
      url: '/telemetry/spans',
      headers: { cookie: responseCookie(userLogin.headers['set-cookie']) },
    });
    expect(userTelemetry.statusCode).toBe(403);
    expect(userTelemetry.json()).toMatchObject({ code: 'FORBIDDEN' });
    const userConversationTelemetry = await app.inject({
      method: 'GET',
      url: '/telemetry/conversations',
      headers: { cookie: responseCookie(userLogin.headers['set-cookie']) },
    });
    expect(userConversationTelemetry.statusCode).toBe(403);
    expect(userConversationTelemetry.json()).toMatchObject({ code: 'FORBIDDEN' });

    for (const credentials of [
      { email: 'admin@chalk.local', password: 'admin123' },
      { email: 'user@chalk.local', password: 'user123' },
      { email: 'dev@chalk.local', password: 'chalk-dev-2026' },
    ]) {
      const legacyLogin = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: credentials,
      });
      expect(legacyLogin.statusCode).toBe(401);
    }

    for (const credentials of [
      { email: 'admin', password: 'admin123' },
      { email: 'user', password: 'user123' },
    ]) {
      const invalidIdentifierLogin = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: credentials,
      });
      expect(invalidIdentifierLogin.statusCode).toBe(400);
    }
  });

  it('logs in, exposes the session, and scopes conversations to the owner', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: developmentUser.email, password: developmentUser.password },
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

  it('advertises only real tools and runs approved title changes', async () => {
    const provider = await app.inject({
      method: 'POST',
      url: '/providers/custom',
      headers: { cookie },
      payload: {
        name: 'Local tool fixture',
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

    const tools = await app.inject({ method: 'GET', url: '/tools', headers: { cookie } });
    expect(tools.statusCode).toBe(200);
    expect(tools.json().tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'rename_current_conversation', requiresApproval: true }),
    ]));
    const toolNames = tools.json().tools.map((tool: { name: string }) => tool.name);
    expect(toolNames).not.toContain('search_learning_resources');
    expect(toolNames).not.toContain('read_uploaded_file');
    if (process.env.CREDENTIAL_ENCRYPTION_KEY) {
      expect(tools.json().tools).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'read_resource', effects: ['read', 'network'], defaultEnabled: true }),
      ]));
    }

    const conversationResponse = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { cookie },
      payload: { title: '工具验证会话' },
    });
    const conversationId = conversationResponse.json().conversation.id as string;

    const approvalMode = await app.inject({
      method: 'PATCH',
      url: '/tools',
      headers: { cookie },
      payload: {
        toolName: 'rename_current_conversation',
        enabled: true,
        approval: 'always',
      },
    });
    expect(approvalMode.statusCode).toBe(200);

    let approvalResponse: Promise<Response> | undefined;
    const approvalEvents = await streamConversation(conversationId, '审批链路', (type, data) => {
      if (type !== 'tool_pending') return;
      approvalResponse = fetch(`${apiBaseUrl}/chat/${conversationId}/approve`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ toolCallId: data.toolCallId, approved: true }),
      });
    });
    expect(approvalResponse).toBeDefined();
    expect((await approvalResponse!).status).toBe(200);
    expect(approvalEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool_pending' }),
      expect.objectContaining({ type: 'tool_finished', data: expect.objectContaining({ toolName: 'rename_current_conversation', isError: false }) }),
    ]));

    const renamed = await app.inject({
      method: 'GET',
      url: `/chat/${conversationId}`,
      headers: { cookie },
    });
    expect(renamed.json().conversation.title).toBe('审批后的学习会话');
  });

  it('persists a redacted run summary for each conversation turn', async () => {
    const provider = await app.inject({
      method: 'POST',
      url: '/providers/custom',
      headers: { cookie },
      payload: {
        name: 'Local observation fixture',
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

    const created = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { cookie },
      payload: { title: 'observed conversation' },
    });
    expect(created.statusCode).toBe(201);
    const conversationId = created.json().conversation.id as string;

    const events = await streamConversation(conversationId, 'PRIVATE_STUDENT_OBSERVATION_INPUT');
    expect(events).toContainEqual(expect.objectContaining({ type: 'result' }));

    const observations = await createAgentRunObservationsDal(getDb())
      .listForConversation(userId, conversationId);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      conversationId,
      userId,
      modelProviderId: fixtureProviderId,
      modelId: 'fixture-model',
      status: 'completed',
    });
    expect(observations[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(observations)).not.toContain('PRIVATE_STUDENT_OBSERVATION_INPUT');

    const adminLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: developmentAdmin.email, password: developmentAdmin.password },
    });
    const adminCookie = responseCookie(adminLogin.headers['set-cookie']);
    const summaries = await app.inject({
      method: 'GET',
      url: '/telemetry/conversations',
      headers: { cookie: adminCookie },
    });
    expect(summaries.statusCode).toBe(200);
    expect(summaries.json().conversations).toContainEqual(expect.objectContaining({
      conversationId,
      title: 'observed conversation',
      runCount: 1,
      statusCounts: { completed: 1, aborted: 0, failed: 0 },
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0,
    }));
    expect(JSON.stringify(summaries.json())).not.toContain('PRIVATE_STUDENT_OBSERVATION_INPUT');

    const details = await app.inject({
      method: 'GET',
      url: `/telemetry/conversations/${conversationId}`,
      headers: { cookie: adminCookie },
    });
    expect(details.statusCode).toBe(200);
    expect(details.json()).toMatchObject({
      summary: expect.objectContaining({ conversationId, runCount: 1 }),
      runs: [expect.objectContaining({ conversationId, status: 'completed' })],
    });
    expect(JSON.stringify(details.json())).not.toContain('PRIVATE_STUDENT_OBSERVATION_INPUT');
  });

  it('returns the original transcript after a compaction entry is written', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { cookie },
      payload: { title: 'transcript after compaction' },
    });
    expect(created.statusCode).toBe(201);
    const conversation = created.json().conversation as { id: string; sessionId: string };
    const session = await openSession(userId, conversation.sessionId);
    const earlyMessage = {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: '早期条件：三角形 ABC 中 AB = AC' }],
      timestamp: 1,
    };
    const recentMessage = {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: '最近必须保留：连接 AC' }],
      timestamp: 2,
    };
    await session.appendMessage(earlyMessage);
    await session.appendMessage(recentMessage);
    await session.appendCompaction({
      summary: '已总结早期条件。',
      retainedTail: [recentMessage],
      tokensBefore: 9_000,
    });

    const history = await app.inject({
      method: 'GET',
      url: `/chat/${conversation.id}/messages`,
      headers: { cookie },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().messages).toEqual([earlyMessage, recentMessage]);
    expect(history.json().messages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'compactionSummary' }),
    ]));
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

  it('rejects private-network MCP URLs at the API seam', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { cookie },
      payload: {
        name: 'local-network',
        transport: 'http',
        url: 'http://127.0.0.1:8080/mcp',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('rejects stdio MCP configuration for non-admin users', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { cookie },
      payload: {
        name: 'local-process',
        transport: 'stdio',
        command: process.execPath,
      },
    });
    expect(response.statusCode).toBe(403);
  });
});
