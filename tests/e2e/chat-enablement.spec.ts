import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { expect, test, type Page } from '@playwright/test';

const apiBaseUrl = (process.env.E2E_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const fixturePrefix = 'E2E Enablement Fixture';
const skillName = 'geometry-coach';
const toolName = 'make_hint_ladder';
const toolLabel = '提示阶梯';
const remainingToolName = 'inspect_problem_structure';

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

type EnablementSession = {
  conversationId: string;
  providerId?: string;
  originalDefaultModel: DefaultModel;
  originalSkillEnabled?: boolean;
  originalTool?: ToolSetting;
  originalRemainingTool?: ToolSetting;
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

function createRecordingFixtureProviderServer(captured: Array<Record<string, unknown>>) {
  return createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    const body = await readJsonRequest(request);
    captured.push(body);
    const id = `fixture-enablement-${captured.length}`;
    streamFixtureResponse(response, [
      {
        id,
        model: 'fixture-model',
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            content: '先写出一个已知关系。',
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

async function restoreEnablementWorkspace(page: Page, session: Partial<EnablementSession>) {
  if (page.isClosed()) return;
  if (session.conversationId) await deleteConversation(page, session.conversationId);
  await page.evaluate(async ({ apiUrl, provider, defaultModel, skillEnabled, tools }) => {
    if (skillEnabled !== undefined) {
      await fetch(`${apiUrl}/skills`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillName: 'geometry-coach', enabled: skillEnabled }),
      });
    }
    for (const tool of tools) {
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
    }
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
    skillEnabled: session.originalSkillEnabled,
    tools: [session.originalTool, session.originalRemainingTool].filter(Boolean),
  });
}

function requestIncludes(request: Record<string, unknown> | undefined, text: string) {
  return JSON.stringify(request ?? {}).includes(text);
}

async function openSettings(page: Page) {
  await page.getByRole('button', { name: '打开用户菜单' }).click();
  await page.getByRole('menuitem', { name: '设置' }).click();
  const dialog = page.getByRole('dialog', { name: '设置' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closeSettings(dialog: ReturnType<Page['getByRole']>) {
  await dialog.getByRole('button', { name: '关闭设置' }).click();
  await expect(dialog).toBeHidden();
}

function settingToggle(dialog: ReturnType<Page['getByRole']>, visibleName: string) {
  return dialog
    .getByText(visibleName, { exact: true })
    .locator('xpath=ancestor::div[1]')
    .getByRole('button', { name: /已启用|已停用|保存中…/ });
}

async function setSettingEnabled(
  dialog: ReturnType<Page['getByRole']>,
  visibleName: string,
  enabled: boolean,
) {
  const toggle = settingToggle(dialog, visibleName);
  await expect(toggle).toBeVisible();
  const desired = enabled ? '已启用' : '已停用';
  if ((await toggle.innerText()) === desired) return;
  await toggle.click();
  await expect(toggle).toHaveText(desired);
}

async function sendAndWait(page: Page, text: string, captured: Array<Record<string, unknown>>) {
  const before = captured.length;
  const replies = page.getByText('先写出一个已知关系。');
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

async function openEnablementChat(page: Page, title: string, session: Partial<EnablementSession>) {
  const providerName = `${fixturePrefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await signIn(page);
  await deleteConversationsByTitlePrefix(page, title);
  await deleteCustomProvidersByPrefix(page, fixturePrefix);
  const providerServer = (page as Page & { _providerServer?: Server })._providerServer;
  if (!providerServer) throw new Error('Fixture provider server is missing');
  const address = providerServer.address() as AddressInfo;
  const providerBaseUrl = `http://127.0.0.1:${address.port}/v1`;

  const setup = await page.evaluate(async ({ apiUrl, name, baseUrl, skill, tool, remainingTool }) => {
    const providersResponse = await fetch(`${apiUrl}/providers`, { credentials: 'include' });
    const providersBody = await providersResponse.json() as { defaultModel: DefaultModel };
    const skillsResponse = await fetch(`${apiUrl}/skills`, { credentials: 'include' });
    const skillsBody = await skillsResponse.json() as { skills?: Array<{ name: string; enabled: boolean }> };
    const toolsResponse = await fetch(`${apiUrl}/tools`, { credentials: 'include' });
    const toolsBody = await toolsResponse.json() as { tools?: ToolSetting[] };
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
      originalSkillEnabled: skillsBody.skills?.find((item) => item.name === skill)?.enabled,
      originalTool: toolsBody.tools?.find((item) => item.name === tool),
      originalRemainingTool: toolsBody.tools?.find((item) => item.name === remainingTool),
    };
  }, {
    apiUrl: apiBaseUrl,
    name: providerName,
    baseUrl: providerBaseUrl,
    skill: skillName,
    tool: toolName,
    remainingTool: remainingToolName,
  });

  expect(setup.createStatus, JSON.stringify(setup.createdBody)).toBe(201);
  expect(setup.createdBody.provider?.id).toBeTruthy();
  session.providerId = setup.createdBody.provider?.id;
  session.originalDefaultModel = setup.defaultModel;
  session.originalSkillEnabled = setup.originalSkillEnabled;
  session.originalTool = setup.originalTool;
  session.originalRemainingTool = setup.originalRemainingTool;

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
}

async function withEnablementFixture(
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

test('student can disable a skill from settings and the next run omits it', async ({ page }) => {
  const session: Partial<EnablementSession> = {};
  await withEnablementFixture(page, async (captured) => {
    try {
      await openEnablementChat(page, '浏览器停用 Skill', session);
      const dialog = await openSettings(page);
      await dialog.getByRole('tab', { name: 'Skills' }).click();
      await expect(dialog.getByRole('heading', { name: 'Skills' })).toBeVisible();
      await expect(dialog.getByText(skillName, { exact: true })).toBeVisible();
      await setSettingEnabled(dialog, skillName, true);
      await closeSettings(dialog);

      const enabledRequest = await sendAndWait(page, '验证启用的 Skill', captured);
      expect(requestIncludes(enabledRequest, skillName)).toBe(true);
      expect(requestIncludes(enabledRequest, 'Guide geometry learners')).toBe(true);

      const nextDialog = await openSettings(page);
      await nextDialog.getByRole('tab', { name: 'Skills' }).click();
      await setSettingEnabled(nextDialog, skillName, false);
      await closeSettings(nextDialog);

      const disabledRequest = await sendAndWait(page, '验证停用的 Skill', captured);
      expect(requestIncludes(disabledRequest, skillName)).toBe(false);
      expect(requestIncludes(disabledRequest, 'Guide geometry learners')).toBe(false);
    } finally {
      await restoreEnablementWorkspace(page, session);
    }
  });
});

test('student can disable a tool from settings and the next run omits it', async ({ page }) => {
  const session: Partial<EnablementSession> = {};
  await withEnablementFixture(page, async (captured) => {
    try {
      await openEnablementChat(page, '浏览器停用工具', session);
      const baseline = await page.evaluate(async ({ apiUrl, tool }) => {
        const response = await fetch(`${apiUrl}/tools`, {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            toolName: tool,
            enabled: true,
            approval: 'default',
          }),
        });
        return { status: response.status, body: await response.json() };
      }, { apiUrl: apiBaseUrl, tool: remainingToolName });
      expect(baseline.status, JSON.stringify(baseline.body)).toBe(200);
      const dialog = await openSettings(page);
      await dialog.getByRole('tab', { name: 'Tools' }).click();
      await expect(dialog.getByRole('heading', { name: 'Tools' })).toBeVisible();
      await expect(dialog.getByText(toolLabel, { exact: true })).toBeVisible();
      await setSettingEnabled(dialog, toolLabel, true);
      await closeSettings(dialog);

      const enabledRequest = await sendAndWait(page, '验证启用的工具', captured);
      expect(requestIncludes(enabledRequest, toolName)).toBe(true);
      expect(requestIncludes(enabledRequest, remainingToolName)).toBe(true);

      const nextDialog = await openSettings(page);
      await nextDialog.getByRole('tab', { name: 'Tools' }).click();
      await setSettingEnabled(nextDialog, toolLabel, false);
      await closeSettings(nextDialog);

      const disabledRequest = await sendAndWait(page, '验证停用的工具', captured);
      expect(requestIncludes(disabledRequest, toolName)).toBe(false);
      expect(requestIncludes(disabledRequest, remainingToolName)).toBe(true);
    } finally {
      await restoreEnablementWorkspace(page, session);
    }
  });
});
