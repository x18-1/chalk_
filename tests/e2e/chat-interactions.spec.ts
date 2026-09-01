import { expect, test } from '@playwright/test';

const apiBaseUrl = (process.env.E2E_API_URL ?? 'http://localhost:3001').replace(/\/$/, '');

async function signIn(page: import('@playwright/test').Page) {
  const email = process.env.DEV_USER_EMAIL ?? 'user@qq.com';
  const password = process.env.DEV_USER_PASSWORD ?? 'user123';
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

test('keeps the last conversation menu on screen without changing sidebar scroll height', async ({ page }) => {
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
    const scrollHeightBeforeOpeningMenu = await list.evaluate((element) => element.scrollHeight);
    await lastMenuButton.click();
    const deleteButton = lastMenuButton.locator('..').getByRole('menuitem', { name: '删除' });
    await expect.poll(() => list.evaluate((element) => element.scrollHeight)).toBe(scrollHeightBeforeOpeningMenu);

    const viewport = page.viewportSize();
    const fullyVisible = await deleteButton.boundingBox()
      .then((buttonBox) => Boolean(
        buttonBox && viewport &&
        buttonBox.y >= 0 &&
        buttonBox.y + buttonBox.height <= viewport.height
      ));
    expect(fullyVisible).toBe(true);
  } finally {
    for (const id of createdIds) await deleteConversation(page, id);
  }
});

test('renders one tutor identity while a response is starting', async ({ page }) => {
  await signIn(page);
  let conversationCreateCount = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url() === `${apiBaseUrl}/chat`) conversationCreateCount += 1;
  });

  await page.getByRole('button', { name: '新建对话' }).click();
  await expect(page).toHaveURL(/\/chat\?new=1$/);
  await expect(page.getByRole('button', { name: '新建对话' })).toHaveClass(/activeNavItem/);
  await page.waitForTimeout(250);
  expect(conversationCreateCount).toBe(0);

  let conversationId: string | null = null;
  try {
    await page.route('**/chat/*/stream', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.abort('failed');
    });

    await page.getByLabel('消息内容').fill('验证流式消息头');
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.locator('[class*="thinkingLine"]')).toHaveText('Thinking…');
    await expect.poll(() => conversationCreateCount).toBe(1);
    conversationId = new URL(page.url()).searchParams.get('conversation');
    expect(conversationId).toBeTruthy();

    const tutorHeaders = page.locator('[class*="messageAuthor"]').filter({ hasText: 'Chalk' });
    await expect(tutorHeaders).toHaveCount(1);
    await expect(tutorHeaders).not.toContainText('Thinking…');
  } finally {
    if (conversationId) await deleteConversation(page, conversationId);
  }
});

test('keeps one conversation answering while the student switches to another', async ({ page }) => {
  await signIn(page);
  const suffix = Date.now().toString(36);
  const titleA = `后台回答 A ${suffix}`;
  const titleB = `并行提问 B ${suffix}`;
  const promptA = `开始回答 A ${suffix}`;
  const promptB = `开始回答 B ${suffix}`;
  const conversationA = await createConversation(page, titleA);
  const conversationB = await createConversation(page, titleB);
  let releaseConversationA!: () => void;
  const conversationAReleased = new Promise<void>((resolve) => {
    releaseConversationA = resolve;
  });
  let markConversationAStarted!: () => void;
  const conversationAStarted = new Promise<void>((resolve) => {
    markConversationAStarted = resolve;
  });

  try {
    await page.route('**/chat/*/stream', async (route) => {
      const conversationId = new URL(route.request().url()).pathname.split('/').at(-2);
      if (conversationId === conversationA) {
        markConversationAStarted();
        await conversationAReleased;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: conversationId === conversationA
          ? `event: message_completed\ndata: ${JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'A 已经独立完成回答。' }], stopReason: 'stop' } })}\n\nevent: result\ndata: ${JSON.stringify({ status: 'completed' })}\n\n`
          : `event: message_completed\ndata: ${JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: 'B 也可以同时回答。' }], stopReason: 'stop' } })}\n\nevent: result\ndata: ${JSON.stringify({ status: 'completed' })}\n\n`,
      });
    });

    await page.goto(`/chat?conversation=${conversationA}`);
    const recentConversations = page.getByRole('navigation', { name: '最近对话' });
    await expect(recentConversations.getByRole('button', { name: titleA, exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByLabel('消息内容').fill(promptA);
    await page.getByRole('button', { name: '发送消息' }).click();
    await conversationAStarted;
    const conversationAButton = recentConversations.getByRole('button', { name: new RegExp(`^${promptA}( 正在回答)?$`) });
    await expect(conversationAButton).toContainText('正在回答');

    await recentConversations.getByRole('button', { name: titleB, exact: true }).click();
    await page.getByLabel('消息内容').fill(promptB);
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.getByText('B 也可以同时回答。')).toBeVisible();

    releaseConversationA();
    await conversationAButton.click();
    await expect(page.getByText('A 已经独立完成回答。')).toBeVisible();
    await expect(page.getByText('B 也可以同时回答。')).toHaveCount(0);
  } finally {
    releaseConversationA();
    await deleteConversation(page, conversationA);
    await deleteConversation(page, conversationB);
  }
});

test('stops only the selected conversation when two conversations are answering', async ({ page }) => {
  await signIn(page);
  const suffix = Date.now().toString(36);
  const titleA = `只停止 A ${suffix}`;
  const titleB = `继续回答 B ${suffix}`;
  const promptA = `启动 A ${suffix}`;
  const promptB = `启动 B ${suffix}`;
  const conversationA = await createConversation(page, titleA);
  const conversationB = await createConversation(page, titleB);
  const abortedConversationIds: string[] = [];
  const releaseStreams = new Map<string, () => void>();

  try {
    await page.route('**/chat/*/stream', async (route) => {
      const conversationId = new URL(route.request().url()).pathname.split('/').at(-2);
      if (!conversationId) return route.abort();
      await new Promise<void>((resolve) => releaseStreams.set(conversationId, resolve));
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `event: message_completed\ndata: ${JSON.stringify({ message: { role: 'assistant', content: [{ type: 'text', text: `${conversationId} completed` }], stopReason: 'stop' } })}\n\n`,
      }).catch(() => undefined);
    });
    await page.route('**/chat/*/abort', async (route) => {
      const conversationId = new URL(route.request().url()).pathname.split('/').at(-2);
      if (conversationId) abortedConversationIds.push(conversationId);
      await route.fulfill({ json: { ok: true } });
    });

    await page.goto(`/chat?conversation=${conversationA}`);
    const recentConversations = page.getByRole('navigation', { name: '最近对话' });
    await expect(recentConversations.getByRole('button', { name: titleA, exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByLabel('消息内容').fill(promptA);
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect.poll(() => releaseStreams.has(conversationA)).toBe(true);

    await recentConversations.getByRole('button', { name: titleB, exact: true }).click();
    await page.getByLabel('消息内容').fill(promptB);
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect.poll(() => releaseStreams.has(conversationB)).toBe(true);

    await recentConversations.getByRole('button', { name: new RegExp(`^${promptA}( 正在回答)?$`) }).click();
    await page.getByRole('button', { name: '停止' }).click();
    await expect.poll(() => abortedConversationIds).toEqual([conversationA]);
    await expect(recentConversations.getByRole('button', { name: `${promptB} 正在回答`, exact: true })).toContainText('正在回答');
  } finally {
    for (const release of releaseStreams.values()) release();
    await deleteConversation(page, conversationA);
    await deleteConversation(page, conversationB);
  }
});

test('closes a conversation menu on one outside click and shows a clear delete confirmation', async ({ page }) => {
  await signIn(page);
  const list = page.getByRole('navigation', { name: '最近对话' });
  const menuButton = list.getByRole('button', { name: /的更多操作$/ }).first();

  await menuButton.scrollIntoViewIfNeeded();
  await menuButton.click();
  await expect(page.getByRole('menuitem', { name: '重命名' })).toBeVisible();
  await page.getByRole('button', { name: '新建对话' }).click();
  await expect(page.getByRole('menuitem', { name: '重命名' })).toHaveCount(0);

  await menuButton.click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  const confirmation = page.getByRole('dialog', { name: '删除这段对话？' });
  await expect(confirmation).toContainText('删除这段对话？');
  await expect(confirmation).toContainText('删除后，对话记录将无法恢复。');
  const confirmationBox = await confirmation.boundingBox();
  const viewport = page.viewportSize();
  expect(confirmationBox && viewport && Math.abs(confirmationBox.x + confirmationBox.width / 2 - viewport.width / 2) < 2).toBe(true);
  expect(confirmationBox && viewport && Math.abs(confirmationBox.y + confirmationBox.height / 2 - viewport.height / 2) < 2).toBe(true);
  await confirmation.getByRole('button', { name: '取消' }).click();
  await expect(confirmation).toHaveCount(0);
});

test('keeps the learning workspace visible while switching protected routes', async ({ page }) => {
  await signIn(page);
  await expect(page.getByText('正在打开学习空间…')).toHaveCount(0);
  await page.evaluate(() => {
    const windowWithCounter = window as typeof window & { authLoaderMounts?: number };
    windowWithCounter.authLoaderMounts = 0;
    new MutationObserver(() => {
      if (document.body.textContent?.includes('正在打开学习空间…')) windowWithCounter.authLoaderMounts! += 1;
    }).observe(document.body, { childList: true, subtree: true });
  });

  await page.getByRole('link', { name: 'Chats' }).click();
  await expect(page).toHaveURL(/\/chats$/);
  await page.getByRole('link', { name: 'Chalkboard' }).click();
  await expect(page).toHaveURL(/\/chalkboard$/);
  await expect.poll(() => page.evaluate(() => (window as typeof window & { authLoaderMounts?: number }).authLoaderMounts)).toBe(0);
});

test('keeps thinking private while restoring multiple tool results from durable history', async ({ page }) => {
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
                { type: 'toolCall', id: 'history-tool-1', name: 'fixture_inspection_tool' },
                { type: 'toolCall', id: 'history-tool-2', name: 'mcp__geometry__very_long_relationship_verification_tool_name' },
              ],
            },
            {
              role: 'toolResult',
              timestamp: Date.now() - 1_500,
              toolCallId: 'history-tool-1',
              toolName: 'fixture_inspection_tool',
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
              details: {
                type: 'scene',
                scene: {
                  id: 'history-relationship-scene',
                  title: '关系示意图',
                  order: 0,
                  type: 'slide',
                  actionCount: 0,
                  content: {
                    type: 'slide',
                    canvas: {
                      elements: [{ type: 'text', content: 'AB = AC', left: 120, top: 80, width: 240, height: 60 }],
                    },
                  },
                },
              },
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
    await expect(page.getByText('fixture inspection tool', { exact: true })).toBeVisible();
    await expect(page.getByText('MCP · very long relationship verification tool name', { exact: true })).toBeVisible();
    await expect(page.getByText('fixture inspection tool已完成。', { exact: true })).toBeVisible();
    await expect(page.getByText('MCP · very long relationship verification tool name已完成。', { exact: true })).toBeVisible();
    await expect(page.getByRole('figure', { name: 'Chalkboard Scene：关系示意图' })).toBeVisible();
    await expect(page.getByRole('figure', { name: 'Chalkboard Scene：关系示意图' })).toContainText('AB = AC');
    await expect(page.getByText('先识别已知条件，再检查可以直接使用的关系。')).toHaveCount(0);
    await page.getByText('查看结果', { exact: true }).first().click();
    await expect(page.getByText('已识别三条已知关系。')).toBeVisible();
  } finally {
    await deleteConversation(page, conversationId);
  }
});

test('renders a Chalkboard block returned by a Chat tool', async ({ page }) => {
  await signIn(page);
  const conversationId = await createConversation(page, '聊天黑板渲染测试');

  try {
    await page.goto(`/chat?conversation=${conversationId}`);
    await page.route(`**/chat/${conversationId}/stream`, async (route) => {
      const block = {
        type: 'chalkboard',
        version: 1,
        title: '平方关系',
        content: {
          type: 'slide',
          canvas: {
            elements: [{ type: 'text', content: 'a² + b² = c²', left: 120, top: 80, width: 300, height: 70 }],
          },
        },
      };
      const events = [
        ['tool_started', { toolCallId: 'render-tool-1', toolName: 'render_chalkboard' }],
        ['tool_finished', {
          toolCallId: 'render-tool-1',
          toolName: 'render_chalkboard',
          isError: false,
          result: { content: [{ type: 'text', text: '已在当前聊天中插入一个 Chalkboard Scene。' }], details: {
            type: 'scene',
            scene: {
              id: 'chat-scene-ping-fang-guan-xi',
              title: block.title,
              order: 0,
              type: 'slide',
              actionCount: 0,
              content: block.content,
            },
          } },
        }],
        ['message_completed', { message: { role: 'assistant', content: [{ type: 'text', text: '这是勾股定理的关系。' }], stopReason: 'stop' } }],
        ['result', { status: 'completed' }],
      ];
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: `${events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join('')}`,
      });
    });

    await page.getByLabel('消息内容').fill('展示勾股定理');
    await page.getByRole('button', { name: '发送消息' }).click();
    await expect(page.getByRole('figure', { name: 'Chalkboard Scene：平方关系' })).toBeVisible();
    await expect(page.getByRole('figure', { name: 'Chalkboard Scene：平方关系' })).toContainText('a² + b² = c²');
    await expect(page.getByText('这是勾股定理的关系。')).toBeVisible();
  } finally {
    await deleteConversation(page, conversationId);
  }
});

test('renders GFM tables from tutor messages in a scrollable reading area', async ({ page }) => {
  await signIn(page);
  const conversationId = await createConversation(page, 'Markdown 表格渲染测试');

  try {
    await page.route(`**/chat/${conversationId}/messages`, async (route) => {
      await route.fulfill({
        json: {
          messages: [{
            role: 'assistant',
            timestamp: Date.now(),
            content: [{ type: 'text', text: `| | 欧拉角 (roll/pitch/yaw) | 四元数 |
|---|---|---|
| 参数个数 | 3 | 4（多一个冗余） |
| 万向节锁（gimbal lock） | 有（俯仰 ±90° 时丢失自由度） | 无 |
| 插值平滑 | 不平滑，角速度变化剧烈 | slerp 球面线性插值，平滑 |
| 复合旋转 | 矩阵乘法繁琐 | 直接 q_total = q₂·q₁ |
| 数值稳定性 | 奇异点附近不稳定 | 归一化即可，非常稳定 |` }],
            stopReason: 'stop',
          }],
        },
      });
    });

    await page.goto(`/chat?conversation=${conversationId}`);
    const tableRegion = page.getByRole('region', { name: '表格内容' });
    const table = tableRegion.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.locator('thead th')).toHaveCount(3);
    await expect(table.locator('tbody tr')).toHaveCount(5);
    await expect(table).toContainText('欧拉角 (roll/pitch/yaw)');
    await expect(table).toContainText('归一化即可，非常稳定');
    await expect(tableRegion).toHaveCSS('overflow-x', 'auto');
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
