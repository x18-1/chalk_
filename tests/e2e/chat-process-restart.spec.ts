import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test, type Page } from '@playwright/test';

const apiBaseUrl = (process.env.E2E_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const apiPid = Number(process.env.E2E_API_PID ?? '');
const restartCommand = process.env.E2E_API_RESTART_COMMAND;
const fixturePrefix = 'E2E Process Restart Fixture';
const conversationTitle = 'E2E 进程重启恢复测试';
const firstQuestion = '第一轮问题：等腰三角形的底角有什么关系？';
const secondQuestion = '第二轮问题：请继续刚才的题目。';
const firstAnswer = '第一轮回答：两个底角相等。';
const resumedAnswer = '已恢复上下文：刚才讨论的是等腰三角形的底角关系。';

test.skip(!Number.isInteger(apiPid) || apiPid <= 0 || !restartCommand, '需要 E2E_API_PID 和 E2E_API_RESTART_COMMAND 才运行真实进程重启测试');

type DefaultModel = {
  providerId: string;
  modelId: string;
  thinkingLevel: string;
} | null;

async function signIn(page: Page) {
  const email = process.env.DEV_USER_EMAIL ?? 'user@qq.com';
  const password = process.env.DEV_USER_PASSWORD ?? 'user123';
  await page.goto('/login');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '进入 Chalk' }).click();
  await expect(page).toHaveURL(/\/chat(?:\?.*)?$/);
}

async function apiJson<T>(page: Page, path: string, init?: RequestInit) {
  return page.evaluate(async ({ apiUrl, requestPath, requestInit }) => {
    const response = await fetch(`${apiUrl}${requestPath}`, { ...requestInit, credentials: 'include' });
    return { status: response.status, body: await response.json() as T };
  }, { apiUrl: apiBaseUrl, requestPath: path, requestInit: init });
}

async function deleteConversation(page: Page, id: string) {
  await apiJson(page, `/chat/${id}/abort`, { method: 'POST' });
  const deleted = await apiJson(page, `/chat/${id}`, { method: 'DELETE' });
  expect(deleted.status).toBe(200);
}

function sseChunk(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function readJsonRequest(request: import('node:http').IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as { messages?: Array<{ role?: string; content?: unknown }> };
}

function textContent(content: unknown) {
  if (!Array.isArray(content)) return '';
  return content.flatMap((part) => {
    if (!part || typeof part !== 'object') return [];
    const text = (part as { type?: unknown; text?: unknown }).text;
    return typeof text === 'string' ? [text] : [];
  }).join('');
}

function createFixtureProviderServer() {
  return createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    const body = await readJsonRequest(request);
    const messages = body.messages ?? [];
    const userTurns = messages.filter((message) => message.role === 'user');
    const answer = userTurns.length > 1 && userTurns.some((message) => textContent(message.content).includes(firstQuestion))
      ? resumedAnswer
      : firstAnswer;
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    });
    response.end([
      sseChunk({
        id: 'fixture-process-restart',
        model: 'fixture-process-restart-model',
        choices: [{ index: 0, delta: { role: 'assistant', content: answer }, finish_reason: null }],
      }),
      'data: [DONE]\n\n',
    ].join(''));
  });
}

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}

async function closeServer(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function waitForApi(healthy: boolean) {
  await expect.poll(async () => {
    try {
      const response = await fetch(`${apiBaseUrl}/health`);
      return response.ok === healthy;
    } catch {
      return !healthy;
    }
  }, { timeout: 20_000, intervals: [100, 250, 500, 1_000] }).toBe(true);
}

async function stopApi() {
  try {
    process.kill(-apiPid, 'SIGTERM');
  } catch {
    process.kill(apiPid, 'SIGTERM');
  }
  await waitForApi(false);
}

async function startApi() {
  const child: ChildProcess = spawn(restartCommand!, {
    cwd: process.cwd(),
    shell: true,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  await waitForApi(true);
}

async function configureFixture(page: Page, baseUrl: string) {
  const providerName = `${fixturePrefix} ${Date.now()}`;
  const providers = await apiJson<{ defaultModel: DefaultModel }>(page, '/providers');
  const created = await apiJson<{ provider?: { id: string } }>(page, '/providers/custom', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: providerName,
      baseUrl,
      apiKey: 'fixture-key',
      models: [{ id: 'fixture-process-restart-model', name: 'Fixture Process Restart Model', reasoning: false, input: ['text'], contextWindow: 128_000, maxTokens: 8_192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
    }),
  });
  expect(created.status).toBe(201);
  const providerId = created.body.provider?.id;
  expect(providerId).toBeTruthy();
  const selected = await apiJson(page, '/settings/model', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId, modelId: 'fixture-process-restart-model', thinkingLevel: 'off' }),
  });
  expect(selected.status).toBe(200);
  return { providerId: providerId!, originalDefaultModel: providers.body.defaultModel };
}

test('recovers durable history and agent context after a real API process restart', async ({ page }) => {
  const providerServer = createFixtureProviderServer();
  const session: { conversationId?: string; providerId?: string; originalDefaultModel?: DefaultModel } = {};
  await listen(providerServer);
  try {
    await signIn(page);
    const providerBaseUrl = `http://127.0.0.1:${(providerServer.address() as AddressInfo).port}/v1`;
    const fixture = await configureFixture(page, providerBaseUrl);
    session.providerId = fixture.providerId;
    session.originalDefaultModel = fixture.originalDefaultModel;

    const created = await apiJson<{ conversation: { id: string } }>(page, '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: conversationTitle }),
    });
    expect(created.status).toBe(201);
    session.conversationId = created.body.conversation.id;
    await page.goto(`/chat?conversation=${session.conversationId}`);
    await page.getByLabel('消息内容').fill(firstQuestion);
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.getByText(firstAnswer)).toBeVisible();

    await stopApi();
    await startApi();

    await page.reload();
    await expect(page.getByText(firstQuestion)).toBeVisible();
    await expect(page.getByText(firstAnswer)).toBeVisible();
    await page.getByLabel('消息内容').fill(secondQuestion);
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.getByText(resumedAnswer)).toBeVisible();
  } finally {
    if (!page.isClosed() && session.conversationId) await deleteConversation(page, session.conversationId).catch(() => undefined);
    if (!page.isClosed()) {
      if (session.originalDefaultModel) {
        await apiJson(page, '/settings/model', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(session.originalDefaultModel),
        }).catch(() => undefined);
      }
      if (session.providerId) await apiJson(page, `/providers/custom/${session.providerId}`, { method: 'DELETE' }).catch(() => undefined);
    }
    await closeServer(providerServer);
  }
});
