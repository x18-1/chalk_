import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test, type Page } from '@playwright/test';

const apiBaseUrl = (process.env.E2E_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const fixturePrefix = 'E2E Switch Fixture';
const conversationPrefix = '浏览器切换模型';
const alphaModel = {
  id: 'fixture-alpha',
  name: 'Fixture Alpha',
  reply: 'Alpha 先写一个已知关系。',
} as const;
const betaModel = {
  id: 'fixture-beta',
  name: 'Fixture Beta',
  reply: 'Beta 先写一个已知关系。',
} as const;

type DefaultModel = {
  providerId: string;
  modelId: string;
  thinkingLevel: string;
} | null;

type SwitchSession = {
  conversationId: string;
  providerId?: string;
  providerName?: string;
  originalDefaultModel: DefaultModel;
};

async function signIn(page: Page) {
  const email = process.env.DEV_USER_EMAIL ?? 'user@qq.com';
  const password = process.env.DEV_USER_PASSWORD ?? 'user123';
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
  return page.evaluate(async ({ apiUrl, conversationTitle }) => {
    const response = await fetch(`${apiUrl}/chat`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: conversationTitle }),
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

function replyForModel(modelId: string) {
  if (modelId === betaModel.id) return betaModel.reply;
  return alphaModel.reply;
}

function createRecordingFixtureProviderServer(captured: Array<Record<string, unknown>>) {
  return createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    const body = await readJsonRequest(request);
    captured.push(body);
    const modelId = typeof body.model === 'string' ? body.model : 'unknown';
    const id = `fixture-switch-${captured.length}`;
    streamFixtureResponse(response, [
      {
        id,
        model: modelId,
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            content: replyForModel(modelId),
          },
          finish_reason: null,
        }],
      },
      {
        id,
        model: modelId,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      },
    ]);
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

async function restoreSwitchWorkspace(page: Page, session: Partial<SwitchSession>) {
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

async function sendAndWait(
  page: Page,
  text: string,
  expectedReply: string,
  captured: Array<Record<string, unknown>>,
) {
  const before = captured.length;
  const replies = page.getByText(expectedReply, { exact: true });
  const replyCount = await replies.count();
  await page.getByLabel('消息内容').fill(text);
  await expect(page.getByRole('button', { name: '发送消息' })).toBeEnabled();
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByLabel('数学对话').getByText(text, { exact: true })).toBeVisible();
  await expect(replies).toHaveCount(replyCount + 1);
  await expect(page.getByRole('button', { name: '发送消息' })).toBeVisible();
  await expect.poll(() => captured.length).toBe(before + 1);
  return captured.at(-1);
}

async function currentDefaultModelId(page: Page) {
  return page.evaluate(async ({ apiUrl }) => {
    const response = await fetch(`${apiUrl}/settings`, { credentials: 'include' });
    const body = await response.json() as { defaultModel?: DefaultModel };
    return body.defaultModel?.modelId ?? null;
  }, { apiUrl: apiBaseUrl });
}

function fixtureModelPayload(model: { id: string; name: string }) {
  return {
    id: model.id,
    name: model.name,
    reasoning: false,
    input: ['text'],
    contextWindow: 128_000,
    maxTokens: 8_192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
}

async function openSwitchChat(page: Page, title: string, session: Partial<SwitchSession>) {
  const providerName = `${fixturePrefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await signIn(page);
  await deleteConversationsByTitlePrefix(page, conversationPrefix);
  await deleteCustomProvidersByPrefix(page, fixturePrefix);
  const providerServer = (page as Page & { _providerServer?: Server })._providerServer;
  if (!providerServer) throw new Error('Fixture provider server is missing');
  const address = providerServer.address() as AddressInfo;
  const providerBaseUrl = `http://127.0.0.1:${address.port}/v1`;

  const setup = await page.evaluate(async ({ apiUrl, name, baseUrl, models }) => {
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
        models,
      }),
    });
    const createdBody = await created.json() as { provider?: { id: string }; code?: string; error?: string };
    return {
      createStatus: created.status,
      createdBody,
      defaultModel: providersBody.defaultModel ?? null,
    };
  }, {
    apiUrl: apiBaseUrl,
    name: providerName,
    baseUrl: providerBaseUrl,
    models: [fixtureModelPayload(alphaModel), fixtureModelPayload(betaModel)],
  });

  expect(setup.createStatus, JSON.stringify(setup.createdBody)).toBe(201);
  expect(setup.createdBody.provider?.id).toBeTruthy();
  session.providerId = setup.createdBody.provider?.id;
  session.providerName = providerName;
  session.originalDefaultModel = setup.defaultModel;

  const selected = await page.evaluate(async ({ apiUrl, providerId, modelId }) => {
    const response = await fetch(`${apiUrl}/settings/model`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId,
        modelId,
        thinkingLevel: 'off',
      }),
    });
    return { status: response.status, body: await response.json() };
  }, {
    apiUrl: apiBaseUrl,
    providerId: setup.createdBody.provider?.id,
    modelId: alphaModel.id,
  });
  expect(selected.status, JSON.stringify(selected.body)).toBe(200);

  const conversationId = await createConversation(page, title);
  session.conversationId = conversationId;
  await page.goto(`/chat?conversation=${conversationId}`);
  await expect(page.getByLabel('消息内容')).toBeVisible();
  await expect(page.getByRole('button', { name: alphaModel.name, exact: true })).toBeVisible();
}

async function withSwitchFixture(
  page: Page,
  run: (captured: Array<Record<string, unknown>>) => Promise<void>,
) {
  const captured: Array<Record<string, unknown>> = [];
  const providerServer = createRecordingFixtureProviderServer(captured);
  await listen(providerServer);
  (page as Page & { _providerServer?: Server })._providerServer = providerServer;
  try {
    await run(captured);
  } finally {
    await closeServer(providerServer);
  }
}

test('student can switch models from the composer and the next run uses it', async ({ page }) => {
  const session: Partial<SwitchSession> = {};
  await withSwitchFixture(page, async (captured) => {
    try {
      await openSwitchChat(
        page,
        `${conversationPrefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        session,
      );

      const initialRequest = await sendAndWait(page, '验证初始模型', alphaModel.reply, captured);
      expect(initialRequest?.model).toBe(alphaModel.id);
      await expect(page.getByLabel('数学对话').getByText(alphaModel.reply, { exact: true })).toBeVisible();

      await page.getByRole('button', { name: alphaModel.name, exact: true }).click();
      const modelDialog = page.getByRole('dialog', { name: '选择模型' });
      await expect(modelDialog).toBeVisible();
      await modelDialog.getByRole('button', { name: new RegExp(session.providerName ?? fixturePrefix) }).click();
      await modelDialog.getByRole('button', { name: new RegExp(betaModel.name) }).click();
      await page.keyboard.press('Escape');
      await expect(modelDialog).toBeHidden();
      await expect(page.getByRole('button', { name: betaModel.name, exact: true })).toBeVisible();
      await expect.poll(() => currentDefaultModelId(page)).toBe(betaModel.id);

      const switchedRequest = await sendAndWait(page, '验证切换后的模型', betaModel.reply, captured);
      expect(switchedRequest?.model).toBe(betaModel.id);
      await expect(page.getByLabel('数学对话').getByText(betaModel.reply, { exact: true })).toBeVisible();

      await page.reload();
      await expect(page.getByLabel('消息内容')).toBeVisible();
      await expect(page.getByRole('button', { name: betaModel.name, exact: true })).toBeVisible();
      await expect.poll(() => currentDefaultModelId(page)).toBe(betaModel.id);
    } finally {
      await restoreSwitchWorkspace(page, session);
    }
  });
});
