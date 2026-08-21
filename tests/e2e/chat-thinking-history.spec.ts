import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test, type Page } from '@playwright/test';

const apiBaseUrl = (process.env.E2E_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const fixturePrefix = 'E2E Thinking Fixture';
const conversationPrefix = '浏览器思考历史';
const thinkingText = '先判断学生卡在哪一步，再给一层提示。';
const finalReply = '我们先不急着算，先圈出重复出现的对象。';
const toolResultText = '先圈出题目中重复出现的对象，暂时不要计算。';

type DefaultModel = {
  providerId: string;
  modelId: string;
  thinkingLevel: string;
} | null;

type ToolSetting = {
  name: string;
  enabled: boolean;
  approval: 'default' | 'always' | 'never';
};

type ThinkingSession = {
  conversationId: string;
  providerId?: string;
  originalDefaultModel: DefaultModel;
  originalTool?: ToolSetting;
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

function createThinkingFixtureProviderServer() {
  return createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    const body = await readJsonRequest(request);
    const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
    const hasToolResult = messages.some((message) => message.role === 'tool');
    const id = `fixture-thinking-${hasToolResult ? 'after-tool' : 'tool-call'}`;

    if (!hasToolResult) {
      streamFixtureResponse(response, [
        {
          id,
          model: 'fixture-thinking-model',
          choices: [{
            index: 0,
            delta: {
              role: 'assistant',
              reasoning_content: thinkingText,
            },
            finish_reason: null,
          }],
        },
        {
          id,
          model: 'fixture-thinking-model',
          choices: [{
            index: 0,
            delta: {
              tool_calls: [{
                index: 0,
                id: 'history-hint-1',
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
          model: 'fixture-thinking-model',
          choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
        },
      ]);
      return;
    }

    streamFixtureResponse(response, [
      {
        id,
        model: 'fixture-thinking-model',
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            content: finalReply,
          },
          finish_reason: null,
        }],
      },
      {
        id,
        model: 'fixture-thinking-model',
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

async function restoreThinkingWorkspace(page: Page, session: Partial<ThinkingSession>) {
  if (page.isClosed()) return;
  if (session.conversationId) await deleteConversation(page, session.conversationId);
  await page.evaluate(async ({ apiUrl, provider, tool, defaultModel }) => {
    if (defaultModel) {
      await fetch(`${apiUrl}/settings/model`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(defaultModel),
      });
    }
    if (tool) {
      await fetch(`${apiUrl}/tools`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: tool.name,
          enabled: tool.enabled,
          approval: tool.approval,
        }),
      });
    } else {
      await fetch(`${apiUrl}/tools`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolName: 'make_hint_ladder',
          enabled: true,
          approval: 'default',
        }),
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
    tool: session.originalTool,
    defaultModel: session.originalDefaultModel,
  });
  await deleteCustomProvidersByPrefix(page, fixturePrefix);
  await deleteConversationsByTitlePrefix(page, conversationPrefix);
}

async function openThinkingChat(page: Page, title: string, session: Partial<ThinkingSession>) {
  const providerName = `${fixturePrefix} ${Date.now()}`;
  await signIn(page);
  await deleteConversationsByTitlePrefix(page, conversationPrefix);
  await deleteCustomProvidersByPrefix(page, fixturePrefix);
  const providerServer = (page as Page & { _providerServer?: Server })._providerServer;
  if (!providerServer) throw new Error('Fixture provider server is missing');
  const address = providerServer.address() as AddressInfo;
  const providerBaseUrl = `http://127.0.0.1:${address.port}/v1`;

  const setup = await page.evaluate(async ({ apiUrl, name, baseUrl }) => {
    const providersResponse = await fetch(`${apiUrl}/providers`, { credentials: 'include' });
    const providersBody = await providersResponse.json() as { defaultModel: DefaultModel };
    const toolsResponse = await fetch(`${apiUrl}/tools`, { credentials: 'include' });
    const toolsBody = await toolsResponse.json() as { tools: ToolSetting[] };
    const created = await fetch(`${apiUrl}/providers/custom`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        baseUrl,
        apiKey: 'fixture-key',
        models: [{
          id: 'fixture-thinking-model',
          name: 'Fixture Thinking Model',
          reasoning: true,
          input: ['text'],
          contextWindow: 128_000,
          maxTokens: 8_192,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }],
      }),
    });
    const createdBody = await created.json() as { provider?: { id: string }; code?: string; error?: string };
    const patched = await fetch(`${apiUrl}/tools`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: 'make_hint_ladder',
        enabled: true,
        approval: 'never',
      }),
    });
    return {
      createStatus: created.status,
      createdBody,
      patchStatus: patched.status,
      defaultModel: providersBody.defaultModel ?? null,
      originalTool: toolsBody.tools.find((tool) => tool.name === 'make_hint_ladder'),
    };
  }, { apiUrl: apiBaseUrl, name: providerName, baseUrl: providerBaseUrl });

  expect(setup.createStatus, JSON.stringify(setup.createdBody)).toBe(201);
  expect(setup.patchStatus).toBe(200);
  expect(setup.createdBody.provider?.id).toBeTruthy();
  session.providerId = setup.createdBody.provider?.id;
  session.originalDefaultModel = setup.defaultModel;
  session.originalTool = setup.originalTool;

  const selected = await page.evaluate(async ({ apiUrl, providerId }) => {
    const response = await fetch(`${apiUrl}/settings/model`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId,
        modelId: 'fixture-thinking-model',
        thinkingLevel: 'medium',
      }),
    });
    return { status: response.status, body: await response.json() };
  }, { apiUrl: apiBaseUrl, providerId: setup.createdBody.provider?.id });
  expect(selected.status, JSON.stringify(selected.body)).toBe(200);

  const conversationId = await createConversation(page, title);
  session.conversationId = conversationId;
  await page.goto(`/chat?conversation=${conversationId}`);
  await expect(page.getByLabel('消息内容')).toBeVisible();
  await expect(page.getByRole('button', { name: /Fixture Thinking Model/ })).toBeVisible();
}

async function withThinkingFixture(page: Page, run: () => Promise<void>) {
  const providerServer = createThinkingFixtureProviderServer();
  await listen(providerServer);
  (page as Page & { _providerServer?: Server })._providerServer = providerServer;
  try {
    await run();
  } finally {
    await closeServer(providerServer);
  }
}

test('keeps thinking private while restoring tool history after a live run and reload', async ({ page }) => {
  const session: Partial<ThinkingSession> = {};
  await withThinkingFixture(page, async () => {
    try {
      await openThinkingChat(page, `${conversationPrefix} ${Date.now()}`, session);
      await page.getByLabel('消息内容').fill('我卡在列出已知条件这一步。');
      await page.getByRole('button', { name: '发送消息' }).click();

      await expect(page.getByText('提示阶梯')).toBeVisible();
      await expect(page.getByText('工具调用已完成。')).toBeVisible();
      await expect(page.getByText(finalReply)).toBeVisible();
      await expect(page.getByText(thinkingText)).toHaveCount(0);
      await page.getByText('查看结果', { exact: true }).click();
      await expect(page.getByText(toolResultText)).toBeVisible();

      const history = await page.evaluate(async ({ apiUrl, id }) => {
        const response = await fetch(`${apiUrl}/chat/${id}/messages`, { credentials: 'include' });
        return { status: response.status, body: await response.json() };
      }, { apiUrl: apiBaseUrl, id: session.conversationId });
      expect(history.status).toBe(200);
      expect(JSON.stringify(history.body.messages)).toContain(thinkingText);
      expect(history.body.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: 'toolResult',
          toolCallId: 'history-hint-1',
          isError: false,
        }),
      ]));

      await page.reload();
      await expect(page.getByText(finalReply)).toBeVisible();
      await expect(page.getByText('提示阶梯')).toBeVisible();
      await expect(page.getByText('工具调用已完成。')).toBeVisible();
      await expect(page.getByText(thinkingText)).toHaveCount(0);
      await page.getByText('查看结果', { exact: true }).click();
      await expect(page.getByText(toolResultText)).toBeVisible();
    } finally {
      await restoreThinkingWorkspace(page, session);
    }
  });
});
