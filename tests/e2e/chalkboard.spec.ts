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

async function openClassroom(page: import('@playwright/test').Page) {
  await page.goto('/chalkboard?id=4DuyVUkWv3');
  await expect(page.getByText('CHALKBOARD / PLAYBACK')).toBeVisible({ timeout: 15_000 });
}

test('loads the Chalk-owned classroom fixture when OpenMAIC is offline', async ({ page }) => {
  await signIn(page);
  const response = await page.request.get('/api/openmaic/classroom?id=4DuyVUkWv3');
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['x-chalkboard-source']).toBe('local-fixture');
  const body = await response.json() as { success?: boolean; classroom?: { scenes?: unknown[] } };
  expect(body.success).toBe(true);
  expect(body.classroom?.scenes).toHaveLength(5);
  await openClassroom(page);
});

test('opens the real classroom workspace and completes core panel interactions', async ({ page }) => {
  await signIn(page);
  await openClassroom(page);

  const firstShapePath = page.locator('[class*="canvasShape"] path').first();
  await expect(firstShapePath).toHaveAttribute('d', /\S+/);

  await page.getByRole('button', { name: /两边同时减去同一个数/ }).click();
  const classroomLine = page.locator('[class*="canvasLine"] > path').first();
  await expect(classroomLine).toHaveAttribute('d', /\S+/);
  await expect(classroomLine).toHaveAttribute('marker-end', /arrow/);

  await expect(page.getByRole('complementary', { name: '课程场景' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Notes' })).toBeVisible();
  await expect(page.getByRole('region', { name: '课堂讨论' })).toBeVisible();
  await expect(page.locator('[class*="sceneInteractiveThumbnail"] iframe')).toHaveCount(1);
  await expect(page.locator('[class*="sceneQuizThumbnail"]')).toContainText('小测验');
  await expect(page.locator('[class*="sceneQuizThumbnail"]')).toContainText('知识检查');

  await page.getByRole('button', { name: '收起侧栏' }).click();
  await expect(page.getByRole('button', { name: '展开侧栏' })).toBeVisible();
  await page.getByRole('button', { name: '展开侧栏' }).click();
  await page.getByRole('tab', { name: 'Chat' }).click();
  await expect(page.getByText('当老师发起课堂提问时，这里会出现讨论内容。')).toBeVisible();
  await expect(page.getByText('老师会在播放课堂动作时补充讲解。')).toHaveCount(0);
  const chatInput = page.getByLabel('写下你想追问的地方');
  await chatInput.fill('我想再看一遍移项的依据');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText('我想再看一遍移项的依据')).toBeVisible();

  await page.getByRole('button', { name: /小测验/ }).click();
  await expect(page.getByText('用自己的话检查理解')).toBeVisible();
  await page.getByRole('button', { name: '提交答案' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('请先完成每一道题');
});

test('autoplay advances through authored actions after starting the classroom', async ({ page }) => {
  await signIn(page);
  await openClassroom(page);

  await expect(page.getByText('第 1 页 · 1 / 9')).toBeVisible();
  await page.getByRole('button', { name: '播放', exact: true }).click();

  // Speech is backed by the browser adapter in this test environment. The
  // classroom must still advance after the action completes, rather than
  // leaving playback stuck on the first cursor.
  await expect(page.getByText('第 1 页 · 1 / 9')).toBeHidden({ timeout: 15_000 });
});

test('retries a failed classroom request and restores the playback cursor after refresh', async ({ page }) => {
  await signIn(page);
  let failedRequests = 0;
  await page.route('**/api/openmaic/classroom**', async (route) => {
    if (failedRequests < 2) {
      failedRequests += 1;
      await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ success: false, error: '课堂服务暂时不可用' }) });
      return;
    }
    await route.continue();
  });

  await page.goto('/chalkboard?id=4DuyVUkWv3');
  await expect(page.getByText('课堂暂时无法打开')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByText('CHALKBOARD / PLAYBACK')).toBeVisible();

  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText('第 2 页 · 1 / 10')).toBeVisible();
  await page.reload();
  await expect(page.getByText('第 2 页 · 1 / 10')).toBeVisible();
});

test('keeps playback controls, whiteboard strokes, and interactive widget protocol usable', async ({ page }) => {
  await signIn(page);
  await page.goto('/chalkboard?id=681PbzeDfm');
  await page.evaluate(() => localStorage.removeItem('chalkboard:cursor:681PbzeDfm'));
  await page.reload();
  await expect(page.getByText('CHALKBOARD / PLAYBACK')).toBeVisible();

  const speed = page.getByRole('button', { name: /播放速度/ }).first();
  await expect(speed).toHaveAttribute('aria-label', '播放速度 1 倍');
  await speed.click();
  await expect(speed).toHaveAttribute('aria-label', '播放速度 1.25 倍');

  await page.getByRole('button', { name: '打开白板' }).click();
  const whiteboard = page.getByRole('dialog', { name: '课堂白板' });
  const canvas = whiteboard.getByRole('img', { name: '可书写白板' });
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(150);
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box) {
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + 80);
    await page.mouse.up();
  }
  await expect(canvas.locator('polyline')).toHaveCount(1);
  await whiteboard.getByRole('button', { name: '关闭白板' }).click();

  await page.getByRole('button', { name: '信号合成实验室' }).click();
  await expect(page.getByLabel('聚光').first()).toBeVisible();
  await expect(page.getByLabel('互动状态').first()).toBeVisible();
  const frame = page.locator('[class*="interactiveFrameWrap"] iframe');
  const frameContent = await frame.contentFrame();
  expect(frameContent).not.toBeNull();
  if (frameContent) {
    await expect(frameContent.locator('#harmonicCount-slider')).toHaveValue('6');
    await page.evaluate(() => {
      const iframe = document.querySelector('[class*="interactiveFrameWrap"] iframe');
      iframe?.contentWindow?.postMessage({ type: 'SET_WIDGET_STATE', state: { harmonicCount: 10 } }, '*');
    });
    await expect(frameContent.locator('#harmonicCount-slider')).toHaveValue('10');
  }
});

test('plays an authored video in the active lesson viewport', async ({ page }) => {
  await signIn(page);
  await page.goto('/chalkboard?id=681PbzeDfm');
  await page.evaluate(() => {
    localStorage.setItem('chalkboard:cursor:681PbzeDfm', JSON.stringify({
      version: 1,
      stageId: '681PbzeDfm',
      sceneId: '681PbzeDfm-scene-8',
      sceneIndex: 7,
      actionIndex: 6,
      mode: 'paused',
      completed: false,
    }));
  });
  await page.reload();
  await expect(page.getByText('CHALKBOARD / PLAYBACK')).toBeVisible();

  const video = page.locator('[class*="lessonViewport"] [data-video-element][data-element-id="video_p7VdlaHE"]');
  await expect(video).toHaveCount(1);
  await page.getByRole('button', { name: /播放速度/ }).click();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(async () => video.evaluate((element) => (element as HTMLVideoElement).playbackRate)).toBe(1.25);
  await expect.poll(async () => video.evaluate((element) => (element as HTMLVideoElement).paused)).toBe(false);
});

test('scopes sidebar history by surface and merges it on Chats', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => localStorage.setItem('chalkboard:history', JSON.stringify([
    { id: 'fourier-transform-intro', title: '傅里叶变换入门', lastOpenedAt: 2 },
    { id: '681PbzeDfm', title: '傅里叶变换入门', lastOpenedAt: 1 },
  ])));
  await page.goto('/chalkboard?id=681PbzeDfm');
  await expect(page.getByText('CHALKBOARD / PLAYBACK')).toBeVisible();
  await expect(page.getByRole('region', { name: '最近课堂' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '课堂记录' }).getByRole('link')).toHaveCount(1);
  await expect(page.getByRole('navigation', { name: '课堂记录' }).getByRole('link')).toHaveAttribute('href', '/chalkboard?id=681PbzeDfm');
  await expect(page.getByRole('navigation', { name: '最近对话' })).toHaveCount(0);

  await page.goto('/chat?new=1');
  await expect(page.getByRole('navigation', { name: '最近对话' })).toBeVisible();
  await expect(page.getByRole('region', { name: '最近课堂' })).toHaveCount(0);

  await page.goto('/chats');
  await expect(page.getByRole('navigation', { name: '最近对话' })).toBeVisible();
  await expect(page.getByRole('region', { name: '最近课堂' })).toBeVisible();
});

test('switches classroom from the sidebar without a full page reload', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => localStorage.setItem('chalkboard:history', JSON.stringify([
    { id: '4DuyVUkWv3', title: '等式的性质与移项变号', lastOpenedAt: 2 },
    { id: '681PbzeDfm', title: '傅里叶变换入门', lastOpenedAt: 1 },
  ])));
  await page.goto('/chalkboard?id=4DuyVUkWv3');
  await expect(page.getByRole('heading', { name: '等式的性质与移项变号' })).toBeVisible();
  const target = page.getByRole('navigation', { name: '课堂记录' }).getByRole('link', { name: /傅里叶变换入门/ });
  await expect(target).toHaveAttribute('href', '/chalkboard?id=681PbzeDfm');
  await target.click();
  await expect(page).toHaveURL(/\/chalkboard\?id=681PbzeDfm/);
  await expect(page.getByRole('heading', { name: '傅里叶变换入门' })).toBeVisible();
  await expect(page.locator('[class*="participantAvatar"] img')).toHaveCount(0);
  await expect(page.locator('[class*="participantAvatar"]')).not.toHaveCount(0);
});
