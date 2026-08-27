import { expect, test } from '@playwright/test';

test('student can sign in and open the real settings surface', async ({ page }) => {
  const email = process.env.DEV_USER_EMAIL ?? 'user@qq.com';
  const password = process.env.DEV_USER_PASSWORD ?? 'user123';

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
  await expect(dialog.getByRole('tab', { name: 'API' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('tab', { name: '大模型' })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('complementary', { name: '模型 Provider' })).toBeVisible();
  await dialog.getByRole('complementary', { name: '模型 Provider' }).getByRole('button', { name: /DeepSeek/ }).click();
  const apiKeyInput = dialog.getByLabel('API Key', { exact: true });
  await expect(apiKeyInput).toHaveAttribute('type', 'password');
  await dialog.getByRole('button', { name: '显示 API Key' }).click();
  await expect(apiKeyInput).toHaveAttribute('type', 'text');
  await dialog.getByRole('button', { name: '隐藏 API Key' }).click();
  await expect(apiKeyInput).toHaveAttribute('type', 'password');
  await dialog.getByRole('tab', { name: '语音' }).click();
  const ttsProviders = dialog.getByRole('complementary', { name: '文本转语音 Provider' });
  await expect(ttsProviders.getByRole('button', { name: /本机语音/ })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '本机语音' })).toBeVisible();
  await expect(dialog.getByText('不需要 API Key')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '保存本机语音' })).toBeVisible();
  await dialog.getByRole('tab', { name: 'ASR 语音识别' }).click();
  const asrProviders = dialog.getByRole('complementary', { name: '语音识别 Provider' });
  await expect(asrProviders.getByRole('button', { name: /本机语音识别/ })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '本机语音识别' })).toBeVisible();

  for (const tab of ['Skills', 'MCP', 'Tools']) {
    await dialog.getByRole('tab', { name: tab }).click();
    await expect(dialog.getByRole('heading', { name: tab === 'MCP' ? 'MCP 连接' : tab })).toBeVisible();
  }

  await dialog.getByRole('button', { name: '关闭设置' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: '媒体' }).click();
  const mediaDialog = page.getByRole('dialog', { name: '选择媒体模型' });
  await expect(mediaDialog.getByText('本机语音')).toBeVisible();
  await expect(mediaDialog.getByText('当前使用')).toBeVisible();
  await mediaDialog.getByRole('button', { name: /ASR/ }).click();
  await expect(mediaDialog.getByText('本机语音识别')).toBeVisible();
});

test('video settings remain usable without a saved default or available provider', async ({ page }) => {
  const email = process.env.DEV_USER_EMAIL ?? 'user@qq.com';
  const password = process.env.DEV_USER_PASSWORD ?? 'user123';
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/login');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '进入 Chalk' }).click();
  await expect(page).toHaveURL(/\/chat(?:\?.*)?$/);

  await page.route('**/media/providers', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tts: [], asr: [], image: [], video: [] }),
  }));
  await page.route('**/settings/capabilities', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      image: null,
      video: null,
      speech: { adapter: 'browser', language: 'zh-CN', voiceUri: null, rate: 1, volume: 1 },
    }),
  }));

  await page.getByRole('button', { name: '打开用户菜单' }).click();
  await page.getByRole('menuitem', { name: '设置' }).click();
  const dialog = page.getByRole('dialog', { name: '设置' });
  await dialog.getByRole('tab', { name: '视频' }).click();

  await expect(dialog.getByRole('complementary', { name: '视频生成 Provider' })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '正在读取 Provider' })).toBeVisible();
  await expect(page.getByText(/Application error|Runtime TypeError/)).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('deployment media providers are visible in settings and selectable from Chat', async ({ page }) => {
  const email = process.env.DEV_USER_EMAIL ?? 'user@qq.com';
  const password = process.env.DEV_USER_PASSWORD ?? 'user123';
  let capabilities = {
    image: null as null | { providerId: string; modelId: string | null },
    video: null as null | { providerId: string; modelId: string | null; durationSeconds: number; resolution: '720p' | '1080p' },
    speech: { adapter: 'browser' as const, language: 'zh-CN', voiceUri: null, rate: 1, volume: 1 },
  };

  await page.route('**/media/providers', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      tts: [],
      asr: [],
      image: [{
        capability: 'image', id: 'seedream', name: 'Seedream', defaultBaseUrl: 'https://ark.cn-beijing.volces.com',
        models: [
          { id: 'doubao-seedream-4-0-250828', name: 'Seedream 4.0' },
          { id: 'doubao-seedream-4-5-251128', name: 'Seedream 4.5' },
        ], defaultModel: 'doubao-seedream-4-0-250828',
        baseUrl: 'https://ark.cn-beijing.volces.com', configured: true, credentialSource: 'environment', canRemoveCredential: false,
        requiresApiKey: true, aspectRatios: ['16:9', '4:3', '1:1', '9:16'],
      }],
      video: [{
        capability: 'video', id: 'seedance', name: 'Seedance', defaultBaseUrl: 'https://ark.cn-beijing.volces.com',
        models: [
          { id: 'doubao-seedance-1-0-pro-250528', name: 'Seedance 1.0 Pro' },
          { id: 'doubao-seedance-1-5-pro-251215', name: 'Seedance 1.5 Pro' },
        ], defaultModel: 'doubao-seedance-1-0-pro-250528',
        baseUrl: 'https://ark.cn-beijing.volces.com', configured: true, credentialSource: 'environment', canRemoveCredential: false,
        requiresApiKey: true, aspectRatios: ['16:9'], durations: [5], resolutions: ['720p'],
      }],
    }),
  }));
  await page.route('**/settings/capabilities', async (route) => {
    if (route.request().method() === 'PUT') {
      capabilities = { ...capabilities, ...route.request().postDataJSON() };
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(capabilities) });
  });

  await page.goto('/login');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '进入 Chalk' }).click();
  await expect(page).toHaveURL(/\/chat(?:\?.*)?$/);

  await page.getByRole('button', { name: '打开用户菜单' }).click();
  await page.getByRole('menuitem', { name: '设置' }).click();
  const settings = page.getByRole('dialog', { name: '设置' });
  await settings.getByRole('tab', { name: '生图' }).click();
  await settings.getByRole('complementary', { name: '图片生成 Provider' }).getByRole('button', { name: /Seedream/ }).click();
  await expect(settings.getByText('环境配置', { exact: true })).toBeVisible();
  await expect(settings.getByRole('button', { name: '显示 API Key' })).toBeVisible();
  await settings.getByRole('button', { name: '关闭设置' }).click();

  await page.getByRole('button', { name: '媒体' }).click();
  const media = page.getByRole('dialog', { name: '选择媒体模型' });
  await media.getByRole('button', { name: /生图/ }).click();
  await expect(media.getByText('媒体能力', { exact: true })).toHaveCount(0);
  await expect(media.getByText('默认生成模型与 Chalkboard 共用', { exact: true })).toHaveCount(0);
  await expect(media.getByText('2 个模型 · 环境配置', { exact: true })).toHaveCount(0);
  await expect(media.getByText('Seedream', { exact: true })).toHaveCount(1);
  await expect(media.getByRole('combobox', { name: 'Seedream 模型' })).toHaveValue('doubao-seedream-4-0-250828');
  await expect(media.getByRole('radio', { name: 'Seedream' })).not.toBeChecked();
  await media.getByRole('radio', { name: 'Seedream' }).check();
  await expect.poll(() => capabilities.image).toEqual({ providerId: 'seedream', modelId: 'doubao-seedream-4-0-250828' });
  await expect(media.getByRole('radio', { name: 'Seedream' })).toBeChecked();
  await media.getByRole('combobox', { name: 'Seedream 模型' }).selectOption('doubao-seedream-4-5-251128');
  await expect.poll(() => capabilities.image).toEqual({ providerId: 'seedream', modelId: 'doubao-seedream-4-5-251128' });

  await media.getByRole('button', { name: /视频/ }).click();
  await expect(media.getByText('Seedance', { exact: true })).toHaveCount(1);
  await expect(media.getByRole('combobox', { name: 'Seedance 模型' })).toHaveValue('doubao-seedance-1-0-pro-250528');
  await expect(media.getByRole('radio', { name: 'Seedance' })).not.toBeChecked();
  await media.getByRole('radio', { name: 'Seedance' }).check();
  await expect.poll(() => capabilities.video).toEqual({
    providerId: 'seedance', modelId: 'doubao-seedance-1-0-pro-250528', durationSeconds: 5, resolution: '720p',
  });
  await expect(media.getByRole('radio', { name: 'Seedance' })).toBeChecked();
  await media.getByRole('combobox', { name: 'Seedance 模型' }).selectOption('doubao-seedance-1-5-pro-251215');
  await expect.poll(() => capabilities.video).toEqual({
    providerId: 'seedance', modelId: 'doubao-seedance-1-5-pro-251215', durationSeconds: 5, resolution: '720p',
  });
});
