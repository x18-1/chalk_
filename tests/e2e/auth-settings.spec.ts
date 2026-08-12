import { expect, test } from '@playwright/test';

test('student can sign in and open the real settings surface', async ({ page }) => {
  const email = process.env.DEV_USER_EMAIL ?? 'dev@chalk.local';
  const password = process.env.DEV_USER_PASSWORD ?? 'chalk-dev-2026';

  await page.goto('/login');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '进入 Chalk' }).click();
  await expect(page).toHaveURL(/\/chat(?:\?.*)?$/);
  await expect(page.getByRole('link', { name: 'Chats' })).toBeVisible();

  await page.getByRole('button', { name: '打开用户菜单' }).click();
  await page.getByRole('menuitem', { name: '设置' }).click();
  const dialog = page.getByRole('dialog', { name: '设置' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '模型连接' })).toBeVisible();

  for (const tab of ['Skills', 'MCP', 'Tools']) {
    await dialog.getByRole('tab', { name: tab }).click();
    await expect(dialog.getByRole('heading', { name: tab === 'MCP' ? 'MCP 连接' : tab })).toBeVisible();
  }

  await dialog.getByRole('button', { name: '关闭设置' }).click();
  await expect(dialog).toBeHidden();
});
