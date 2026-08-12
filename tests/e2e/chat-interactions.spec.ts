import { expect, test } from '@playwright/test';

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
  const status = await page.evaluate(async (conversationId) => {
    await fetch(`http://localhost:3001/chat/${conversationId}/abort`, {
      method: 'POST',
      credentials: 'include',
    });
    const response = await fetch(`http://localhost:3001/chat/${conversationId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    return response.status;
  }, id);
  expect(status).toBe(200);
}

test('keeps the last conversation menu inside its scroll area', async ({ page }) => {
  await signIn(page);
  const createdIds = await page.evaluate(async () => {
    const ids: string[] = [];
    for (let index = 0; index < 10; index += 1) {
      const response = await fetch('http://localhost:3001/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `菜单定位测试 ${index + 1}` }),
      });
      const body = await response.json();
      ids.push(body.conversation.id);
    }
    return ids;
  });

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
