import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test, type Page } from '@playwright/test';

const apiBaseUrl = (process.env.E2E_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

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

type ApprovalSession = {
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
    const messages = Array.isArray(body.messages) ? body.messages as Array<Record<string, unknown>> : [];
    const toolContents = messages
      .filter((message) => message.role === 'tool')
      .map((message) => (
        typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? '')
      ));
    const hasToolResult = toolContents.length > 0;
    const hasRejectedTool = toolContents.some((content) => content.includes('拒绝'));
    const latestUser = [...messages].reverse().find((message) => message.role === 'user');
    const userText = typeof latestUser?.content === 'string'
      ? latestUser.content
      : JSON.stringify(latestUser?.content ?? '');
    const id = `fixture-${hasToolResult ? 'after-tool' : 'tool-call'}`;

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
            reasoning_content: hasRejectedTool
              ? '学生拒绝了工具，改用手写提示。'
              : hasToolResult ? '先确认工具结果，再给下一步。' : '先检查学生给出的条件。',
          },
          finish_reason: null,
        }],
      },
      {
        id,
        model: 'fixture-model',
        choices: [{
          index: 0,
          delta: {
            content: hasRejectedTool
              ? '好的，我们不用这个工具，改从已知条件继续。'
              : hasToolResult ? '工具已确认，先圈出题目中的重复对象。' : '先写出一个已知关系。',
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

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function restoreApprovalWorkspace(page: Page, session: Partial<ApprovalSession>) {
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
    await fetch(`${apiUrl}/tools`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: 'make_hint_ladder',
        enabled: tool?.enabled ?? true,
        approval: tool?.approval ?? 'default',
      }),
    });
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
}

async function openPendingApproval(page: Page, title: string): Promise<ApprovalSession> {
  const providerName = `E2E Approval Fixture ${Date.now()}`;
  await signIn(page);
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
    const patched = await fetch(`${apiUrl}/tools`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: 'make_hint_ladder',
        enabled: true,
        approval: 'always',
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

  const conversationId = await createConversation(page, title);
  await page.goto(`/chat?conversation=${conversationId}`);
  await expect(page.getByLabel('消息内容')).toBeVisible();
  const modelButton = page.getByRole('button', { name: /DeepSeek|选择模型|Fixture Model/ });
  await expect(modelButton).toBeVisible();
  await modelButton.click();
  const modelDialog = page.getByRole('dialog', { name: '选择模型' });
  await expect(modelDialog).toBeVisible();
  await modelDialog.getByRole('button', { name: new RegExp(providerName) }).click();
  await modelDialog.getByRole('button', { name: /Fixture Model/ }).click();
  await page.keyboard.press('Escape');
  await expect(modelDialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Fixture Model', exact: true })).toBeVisible();

  await page.getByLabel('消息内容').fill('验证审批链路');
  await page.getByRole('button', { name: '发送消息' }).click();
  await expect(page.getByText('提示阶梯')).toBeVisible();
  await expect(page.getByText('这一步需要你的确认。')).toBeVisible();
  await expect(page.getByRole('button', { name: '允许', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '拒绝', exact: true })).toBeVisible();

  return {
    conversationId,
    providerId: setup.createdBody.provider?.id,
    originalDefaultModel: setup.defaultModel,
    originalTool: setup.originalTool,
  };
}

async function withApprovalFixture(page: Page, run: () => Promise<void>) {
  const providerServer = createFixtureProviderServer();
  await listen(providerServer);
  (page as Page & { _providerServer?: Server })._providerServer = providerServer;
  try {
    await run();
  } finally {
    await closeServer(providerServer);
  }
}

test('student can approve a pending tool call from the browser', async ({ page }) => {
  const session: Partial<ApprovalSession> = {};
  await withApprovalFixture(page, async () => {
    try {
      Object.assign(session, await openPendingApproval(page, '浏览器审批链路'));
      await page.getByRole('button', { name: '允许', exact: true }).click();
      await expect(page.getByText('已允许这次工具调用')).toBeVisible();
      await expect(page.getByText('工具调用已完成。')).toBeVisible();
      await expect(page.getByText('工具已确认，先圈出题目中的重复对象。')).toBeVisible();

      const history = await page.evaluate(async ({ apiUrl, id }) => {
        const response = await fetch(`${apiUrl}/chat/${id}/messages`, { credentials: 'include' });
        return { status: response.status, body: await response.json() };
      }, { apiUrl: apiBaseUrl, id: session.conversationId });
      expect(history.status).toBe(200);
      expect(history.body.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: 'toolResult',
          toolCallId: 'http-approval-call',
          isError: false,
        }),
      ]));
    } finally {
      await restoreApprovalWorkspace(page, session);
    }
  });
});

test('student can reject a pending tool call from the browser', async ({ page }) => {
  const session: Partial<ApprovalSession> = {};
  await withApprovalFixture(page, async () => {
    try {
      Object.assign(session, await openPendingApproval(page, '浏览器拒绝审批'));
      await page.getByRole('button', { name: '拒绝', exact: true }).click();
      await expect(page.getByText('已拒绝这次工具调用', { exact: true })).toBeVisible();
      await expect(page.getByText('你已拒绝这次工具调用。')).toBeVisible();
      await expect(page.getByText('工具调用已完成。')).toHaveCount(0);
      await expect(page.getByText('工具已确认，先圈出题目中的重复对象。')).toHaveCount(0);

      const history = await page.evaluate(async ({ apiUrl, id }) => {
        const response = await fetch(`${apiUrl}/chat/${id}/messages`, { credentials: 'include' });
        return { status: response.status, body: await response.json() };
      }, { apiUrl: apiBaseUrl, id: session.conversationId });
      expect(history.status).toBe(200);
      expect(history.body.messages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          role: 'toolResult',
          toolCallId: 'http-approval-call',
          isError: true,
        }),
      ]));
    } finally {
      await restoreApprovalWorkspace(page, session);
    }
  });
});
