import { expect, test } from '@playwright/test';

async function signIn(page: import('@playwright/test').Page) {
  const email = process.env.DEV_USER_EMAIL ?? 'user@qq.com';
  const password = process.env.DEV_USER_PASSWORD ?? 'user123';
  await page.goto('/login');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '进入 Chalk' }).click();
  await page.waitForURL(/\/chat(?:\?.*)?$/, { timeout: 15_000 });
}

test('new conversation initialization does not rewrite an already canonical URL', async ({ page }) => {
  await signIn(page);
  await page.goto('/chats');

  let releaseProviders: (() => void) | undefined;
  const providersCanRespond = new Promise<void>((resolve) => { releaseProviders = resolve; });
  await page.route('**/providers', async (route) => {
    await providersCanRespond;
    await route.continue();
  });

  await page.getByRole('link', { name: '新建对话' }).click();
  await page.waitForURL(/\/chat\?new=1$/);
  await page.evaluate(() => {
    const browser = window as typeof window & { __chalkRedundantNewChatReplaces: number };
    const replaceState = window.history.replaceState.bind(window.history);
    browser.__chalkRedundantNewChatReplaces = 0;
    window.history.replaceState = (data, unused, url) => {
      if (url === '/chat?new=1') browser.__chalkRedundantNewChatReplaces += 1;
      replaceState(data, unused, url);
    };
  });

  const providerResponse = page.waitForResponse((response) => new URL(response.url()).pathname === '/providers');
  releaseProviders?.();
  await providerResponse;
  await page.waitForTimeout(100);

  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __chalkRedundantNewChatReplaces: number }
  ).__chalkRedundantNewChatReplaces)).toBe(0);

  await page.locator('a[href="/chalkboard"]').click();

  await expect(page).toHaveURL(/\/chalkboard(?:\?.*)?$/, { timeout: 15_000 });
  await expect(page.getByRole('complementary', { name: '主导航' })).toBeVisible();
});

test('Chalkboard keeps the application shell visible while classroom data loads', async ({ page }) => {
  await signIn(page);
  await page.goto('/chats');
  await page.getByRole('link', { name: '新建对话' }).click();
  await page.waitForURL(/\/chat\?new=1$/);
  await page.waitForTimeout(1_000);

  await page.route('**/classrooms', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 450));
    await route.continue();
  });

  await page.locator('a[href="/chalkboard"]').click();
  await expect(page.getByText('正在准备课堂内容…')).toBeVisible();
  expect(await page.getByRole('complementary', { name: '主导航' }).isVisible()).toBe(true);
  await expect(page).toHaveURL(/\/chalkboard(?:\?.*)?$/, { timeout: 15_000 });
});
