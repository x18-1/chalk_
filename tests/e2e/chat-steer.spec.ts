import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test, type Page } from '@playwright/test';

const apiBaseUrl = (process.env.E2E_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const fixturePrefix = 'E2E Steer Fixture';
const conversationTitle = '浏览器引导回答';
const steerPrompt = '改用画图提示';
const firstReply = '先按原思路分析。';
const steeredReply = '好，我们改用图形关系继续。';

type DefaultModel = {
  providerId: string;
  modelId: string;
  thinkingLevel: string;
} | null;

type SteerSession = {
  conversationId: string;
  providerId?: string;
  originalDefaultModel: DefaultModel;
};

async function signIn(page: Page) {
  const email = process.env.DEV_USER_EMAIL ?? 'dev@chalk.local';
  const password = process.env.DEV_USER_PASSWORD ?? 'chalk-dev-2026';
  await page.goto('/login');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '进入 Chalk' }).click();
  await expect(page).toHaveURL(/\/chat(?:\?.*)?$/);
}

async function deleteConversation(page: Page, id: string) {
  const status = await page.evaluate(async ({ apiUrl, conversationId }) => {
    await fetch(`${apiUrl}/chat/${conversationId}/abort`, {
      method: 'POST',
      credentials: 'include',
    });
    const response = await fetch(`${apiUrl}/chat/${conversationId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return response.status;
  }, { apiUrl: apiBaseUrl, conversationId: id });
  expect(status).toBe(200);
}

async function createConversation(page: Page, title: string) {
  return page.evaluate(async ({ apiUrl, conversationTitle: titleText }) => {
    const response = await fetch(`${apiUrl}/chat`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: titleText }),
    });
    const body = await response.json();
    return body.conversation.id as string;
  }, { apiUrl: apiBaseUrl, conversationTitle: title });
}

function sseChunk(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

async function readJsonRequest(request: import('node:http').IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createSteeringFixtureProviderServer() {
  return createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    const body = await readJsonRequest(request);
    const steered = JSON.stringify(body).includes(steerPrompt);
    const id = steered ? 'fixture-steer-followup' : 'fixture-steer-initial';
    const content = steered ? steeredReply : firstReply;

    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
    });
    response.write(sseChunk({
      id,
      model: 'fixture-model',
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content,
        },
        finish_reason: null,
      }],
    }));

    if (!steered) await wait(2_500);
    if (response.writableEnded) return;
    response.write(sseChunk({
      id,
      model: 'fixture-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    }));
    response.end('data: [DONE]\n\n');
  });
}

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}

async function closeServer(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function deleteCustomProvidersByPrefix(page: Page, prefix: string) {
  await page.evaluate(async ({ apiUrl, namePrefix }) => {
    const response = await fetch(`${apiUrl}/providers`, { credentials: 'include' });
    const body = await response.json() as { providers?: Array<{ id: string; name: string; custom?: boolean }> };
    for (const provider of body.providers ?? []) {
      if (provider.custom && provider.name.startsWith(namePrefix)) {
        await fetch(`${apiUrl}/providers/custom/${provider.id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
      }
    }
  }, { apiUrl: apiBaseUrl, namePrefix: prefix });
}

async function deleteConversationsByTitlePrefix(page: Page, prefix: string) {
  await page.evaluate(async ({ apiUrl, titlePrefix }) => {
    const response = await fetch(`${apiUrl}/chat`, { credentials: 'include' });
    const body = await response.json() as { conversations?: Array<{ id: string; title?: string | null }> };
    for (const conversation of body.conversations ?? []) {
      if ((conversation.title ?? '').startsWith(titlePrefix)) {
        await fetch(`${apiUrl}/chat/${conversation.id}/abort`, {
          method: 'POST',
          credentials: 'include',
        });
        await fetch(`${apiUrl}/chat/${conversation.id}`, {
          method: 'DELETE',
          credentials: 'include',
        });
      }
    }
  }, { apiUrl: apiBaseUrl, titlePrefix: prefix });
}

async function restoreSteerWorkspace(page: Page, session: Partial<SteerSession>) {
  if (page.isClosed()) return;
  if (session.conversationId) await deleteConversation(page, session.conversationId);
  await page.evaluate(async ({ apiUrl, provider, defaultModel }) => {
    if (defaultModel) {
      await fetch(`${apiUrl}/settings/model`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(defaultModel),
      });
    }
    if (provider) {
      await fetch(`${apiUrl}/providers/custom/${provider}`, {
        method: 'DELETE',
        credentials: 'include',
      });
    }
  }, {
    apiUrl: apiBaseUrl,
    provider: session.providerId,
    defaultModel: session.originalDefaultModel,
  });
}

function userMessageHasText(message: { role?: unknown; content?: unknown }, text: string) {
  if (message.role !== 'user') return false;
  if (typeof message.content === 'string') return message.content.includes(text);
  return JSON.stringify(message.content ?? '').includes(text);
}

async function openStreamingSteer(page: Page, title: string, session: Partial<SteerSession>) {
  const providerName = `${fixturePrefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await signIn(page);
  await deleteConversationsByTitlePrefix(page, title);
  await deleteCustomProvidersByPrefix(page, fixturePrefix);
  const providerServer = (page as Page & { _providerServer?: Server })._providerServer;
  if (!providerServer) throw new Error('Fixture provider server is missing');
  const address = providerServer.address() as AddressInfo;
  const providerBaseUrl = `http://127.0.0.1:${address.port}/v1`;

  const setup = await page.evaluate(async ({ apiUrl, name, baseUrl }) => {
    const providersResponse = await fetch(`${apiUrl}/providers`, { credentials: 'include' });
    const providersBody = await providersResponse.json() as { defaultModel: DefaultModel };
    const created = await fetch(`${apiUrl}/providers/custom`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        baseUrl,
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
      }),
    });
    const createdBody = await created.json() as { provider?: { id: string }; code?: string; error?: string };
    return {
      createStatus: created.status,
      createdBody,
      defaultModel: providersBody.defaultModel ?? null,
    };
  }, { apiUrl: apiBaseUrl, name: providerName, baseUrl: providerBaseUrl });

  expect(setup.createStatus, JSON.stringify(setup.createdBody)).toBe(201);
  expect(setup.createdBody.provider?.id).toBeTruthy();
  session.providerId = setup.createdBody.provider?.id;
  session.originalDefaultModel = setup.defaultModel;

  const selected = await page.evaluate(async ({ apiUrl, providerId }) => {
    const response = await fetch(`${apiUrl}/settings/model`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId,
        modelId: 'fixture-model',
        thinkingLevel: 'off',
      }),
    });
    return { status: response.status, body: await response.json() };
  }, { apiUrl: apiBaseUrl, providerId: setup.createdBody.provider?.id });
  expect(selected.status, JSON.stringify(selected.body)).toBe(200);

  const conversationId = await createConversation(page, title);
  session.conversationId = conversationId;
  await page.goto(`/chat?conversation=${conversationId}`);
  await expect(page.getByLabel('消息内容')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fixture Model', exact: true })).toBeVisible();

  await page.getByLabel('消息内容').fill('验证引导链路');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByRole('button', { name: '引导', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '停止', exact: true })).toBeVisible();
  await expect(page.getByText(firstReply)).toBeVisible();
}

async function withSteerFixture(page: Page, run: () => Promise<void>) {
  const providerServer = createSteeringFixtureProviderServer();
  await listen(providerServer);
  (page as Page & { _providerServer?: Server })._providerServer = providerServer;
  try {
    await run();
  } finally {
    await closeServer(providerServer);
  }
}

test('student can steer an in-flight reply from the browser', async ({ page }) => {
  const session: Partial<SteerSession> = {};
  await withSteerFixture(page, async () => {
    try {
      await openStreamingSteer(page, conversationTitle, session);
      await page.getByLabel('消息内容').fill(steerPrompt);
      await page.getByRole('button', { name: '引导', exact: true }).click();
      await expect(page.getByRole('status')).toContainText('引导已加入当前运行');
      await expect(page.getByText(steeredReply)).toBeVisible();
      await expect(page.getByText('已停止', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: '发送消息' })).toBeVisible();

      await expect.poll(async () => {
        const history = await page.evaluate(async ({ apiUrl, id }) => {
          const response = await fetch(`${apiUrl}/chat/${id}/messages`, { credentials: 'include' });
          return { status: response.status, body: await response.json() };
        }, { apiUrl: apiBaseUrl, id: session.conversationId });
        expect(history.status).toBe(200);
        const messages = Array.isArray(history.body.messages)
          ? history.body.messages as Array<{ role?: unknown; content?: unknown }>
          : [];
        expect(messages.some((message) => userMessageHasText(message, steerPrompt))).toBe(true);
        return true;
      }).toBe(true);

      await page.reload();
      await expect(page.getByText(firstReply)).toBeVisible();
      await expect(page.getByText(steeredReply)).toBeVisible();
      await expect(page.getByLabel('数学对话').getByText(steerPrompt)).toBeVisible();
      await expect(page.getByText('已停止', { exact: true })).toHaveCount(0);
    } finally {
      await restoreSteerWorkspace(page, session);
    }
  });
});
