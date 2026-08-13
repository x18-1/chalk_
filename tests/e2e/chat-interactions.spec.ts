import { expect, test } from '@playwright/test';

const apiBaseUrl = (process.env.E2E_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

async function signIn(page: import('@playwright/test').Page) {
  const email = process.env.DEV_USER_EMAIL ?? 'dev@chalk.local';
  const password = process.env.DEV_USER_PASSWORD ?? 'chalk-dev-2026';
  await page.goto('/login');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '进入 Chalk' }).click();
  await expect(page).toHaveURL(/\/chat(?:\?.*)?$/);
}

async function deleteConversation(page: import('@playwright/test').Page, id: string) {
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

async function createConversation(page: import('@playwright/test').Page, title: string) {
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

test('keeps the last conversation menu inside its scroll area', async ({ page }) => {
  await signIn(page);
  const createdIds = await page.evaluate(async (apiUrl) => {
    const ids: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const response = await fetch(`${apiUrl}/chat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `菜单定位测试 ${index + 1}` }),
      });
      const body = await response.json();
      ids.push(body.conversation.id);
    }
    return ids;
  }, apiBaseUrl);

  try {
    await page.reload();
    const list = page.getByRole('navigation', { name: '最近对话' });
    const lastMenuButton = list.getByRole('button', { name: /的更多操作$/ }).last();
    await lastMenuButton.scrollIntoViewIfNeeded();
    await lastMenuButton.click();
    const deleteButton = lastMenuButton.locator('..').getByRole('menuitem', { name: '删除' });

    const fullyVisible = await Promise.all([list.boundingBox(), deleteButton.boundingBox()])
      .then(([listBox, buttonBox]) => Boolean(
        listBox && buttonBox &&
        buttonBox.y >= listBox.y &&
        buttonBox.y + buttonBox.height <= listBox.y + listBox.height
      ));
    expect(fullyVisible).toBe(true);
  } finally {
    for (const id of createdIds) await deleteConversation(page, id);
  }
});

test('renders one tutor identity while a response is starting', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: '新建对话' }).click();
  const conversationId = new URL(page.url()).searchParams.get('conversation');

  try {
    await page.route('**/chat/*/stream', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.abort('failed');
    });

    await page.getByLabel('消息内容').fill('验证流式消息头');
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.getByText('正在整理下一步提示')).toBeVisible();

    const tutorHeaders = page.locator('[class*="messageAuthor"]').filter({ hasText: 'Chalk' });
    await expect(tutorHeaders).toHaveCount(1);
    await expect(tutorHeaders).toContainText('正在思考');
  } finally {
    if (conversationId) await deleteConversation(page, conversationId);
  }
});

test('restores thinking and multiple tool results from durable history', async ({ page }) => {
  await signIn(page);
  const conversationId = await createConversation(page, '历史工具状态测试');

  try {
    await page.route(`**/chat/${conversationId}/messages`, async (route) => {
      await route.fulfill({
        json: {
          messages: [
            {
              role: 'user',
              timestamp: Date.now() - 3_000,
              content: [{ type: 'text', text: '请检查这道几何题的结构。' }],
            },
            {
              role: 'assistant',
              timestamp: Date.now() - 2_000,
              content: [
                { type: 'thinking', thinking: '先识别已知条件，再检查可以直接使用的关系。' },
                { type: 'toolCall', id: 'history-tool-1', name: 'inspect_problem_structure' },
                { type: 'toolCall', id: 'history-tool-2', name: 'mcp__geometry__very_long_relationship_verification_tool_name' },
              ],
            },
            {
              role: 'toolResult',
              timestamp: Date.now() - 1_500,
              toolCallId: 'history-tool-1',
              toolName: 'inspect_problem_structure',
              isError: false,
              content: [{ type: 'text', text: '已识别三条已知关系。' }],
            },
            {
              role: 'toolResult',
              timestamp: Date.now() - 1_000,
              toolCallId: 'history-tool-2',
              toolName: 'mcp__geometry__very_long_relationship_verification_tool_name',
              isError: false,
              content: [{ type: 'text', text: '关系校验完成。' }],
            },
            {
              role: 'assistant',
              timestamp: Date.now(),
              content: [{ type: 'text', text: '现在先写出最直接的一组等量关系。' }],
              stopReason: 'stop',
            },
          ],
        },
      });
    });

    await page.goto(`/chat?conversation=${conversationId}`);
    await expect(page.getByText('现在先写出最直接的一组等量关系。')).toBeVisible();
    await expect(page.getByText('题目结构检查')).toBeVisible();
    await expect(page.getByText('MCP · very long relationship verification tool name')).toBeVisible();
    await expect(page.getByText('工具调用已完成。')).toHaveCount(2);
    await expect(page.getByText('先识别已知条件，再检查可以直接使用的关系。')).toBeHidden();

    await page.getByText('思考过程', { exact: true }).click();
    await expect(page.getByText('先识别已知条件，再检查可以直接使用的关系。')).toBeVisible();
    await page.getByText('查看结果', { exact: true }).first().click();
    await expect(page.getByText('已识别三条已知关系。')).toBeVisible();
  } finally {
    await deleteConversation(page, conversationId);
  }
});

test('keeps a structured provider failure above the composer without overflow', async ({ page }) => {
  await signIn(page);
  const conversationId = await createConversation(page, '错误状态布局测试');

  try {
    await page.goto(`/chat?conversation=${conversationId}`);
    await page.route('**/chat/*/stream', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `event: error\ndata: ${JSON.stringify({
          error: 'Provider credential was rejected for an-extremely-long-provider-identifier-that-must-wrap-cleanly',
          code: 'STREAM_PROVIDER_ERROR',
          category: 'provider',
          retryable: true,
        })}\n\n`,
      });
    });

    await page.getByLabel('消息内容').fill('触发结构化错误状态');
    await page.getByRole('button', { name: '发送消息' }).click();

    const failure = page.getByRole('region', { name: '数学对话' }).getByRole('alert');
    await expect(failure).toContainText('模型服务未完成回答');
    await expect(failure.getByRole('button', { name: '打开设置' })).toBeVisible();
    const composer = page.getByLabel('消息内容').locator('..');
    const [failureBox, composerBox, overflow] = await Promise.all([
      failure.boundingBox(),
      composer.boundingBox(),
      failure.evaluate((element) => element.scrollWidth > element.clientWidth),
    ]);
    expect(failureBox && composerBox && failureBox.y + failureBox.height <= composerBox.y).toBe(true);
    expect(overflow).toBe(false);
  } finally {
    await deleteConversation(page, conversationId);
  }
});
