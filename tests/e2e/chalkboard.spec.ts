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

async function openClassroom(
  page: import('@playwright/test').Page,
  title = '等式的性质与移项变号',
  resetCursor = true,
) {
  const records = await classroomRecords(page);
  const classroom = records.find((record) => record.title === title);
  expect(classroom, `Expected seeded classroom ${title}`).toBeDefined();
  if (resetCursor) await resetClassroomCursor(page, classroom!.id);
  await page.goto(`/chalkboard?id=${encodeURIComponent(classroom!.id)}`);
  await expect(page.getByRole('heading', { name: title })).toBeVisible({ timeout: 15_000 });
}

async function resetClassroomCursor(
  page: import('@playwright/test').Page,
  classroomId: string,
  target: { sceneIndex?: number; actionIndex?: number; mode?: 'idle' | 'paused' } = {},
) {
  const apiUrl = (process.env.E2E_API_URL ?? 'http://localhost:3001').replace('127.0.0.1', 'localhost');
  await page.evaluate(async ({ url, id, target }) => {
    const listResponse = await fetch(`${url}/classrooms`, { credentials: 'include' });
    const records = (await listResponse.json() as {
      classrooms: Array<{ id: string; latestArtifact: { id: string } }>;
    }).classrooms;
    const record = records.find((candidate) => candidate.id === id);
    if (!record) throw new Error(`Classroom ${id} was not found`);
    const artifactResponse = await fetch(
      `${url}/classrooms/${id}/artifacts/${record.latestArtifact.id}`,
      { credentials: 'include' },
    );
    const artifact = await artifactResponse.json() as {
      document: { stage: { id: string }; scenes: Array<{ id: string; order: number }> };
    };
    const sessionResponse = await fetch(
      `${url}/classrooms/${id}/artifacts/${record.latestArtifact.id}/learning-session`,
      { method: 'POST', credentials: 'include' },
    );
    const session = (await sessionResponse.json() as {
      learningSession: { id: string; revision: number };
    }).learningSession;
    const scenes = [...artifact.document.scenes].sort((left, right) => left.order - right.order);
    const sceneIndex = target.sceneIndex ?? 0;
    const scene = scenes[sceneIndex];
    const saveResponse = await fetch(`${url}/learning-sessions/${session.id}/cursor`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: session.revision,
        cursor: {
          version: 1,
          stageId: artifact.document.stage.id,
          sceneId: scene?.id ?? null,
          sceneIndex,
          actionIndex: target.actionIndex ?? 0,
          mode: target.mode ?? 'idle',
          completed: false,
        },
      }),
    });
    if (!saveResponse.ok) throw new Error(`Cursor reset failed with ${saveResponse.status}`);
  }, { url: apiUrl, id: classroomId, target });
}

async function classroomRecords(page: import('@playwright/test').Page) {
  const apiUrl = (process.env.E2E_API_URL ?? 'http://localhost:3001').replace('127.0.0.1', 'localhost');
  return page.evaluate(async (url) => {
    const response = await fetch(`${url}/classrooms`, { credentials: 'include' });
    if (!response.ok) throw new Error(`Classroom list failed with ${response.status}`);
    return (await response.json() as { classrooms: Array<{ id: string; title: string }> }).classrooms;
  }, apiUrl);
}

async function openQuizScene(page: import('@playwright/test').Page, resetCursor = true) {
  await openClassroom(page, '等式的性质与移项变号', resetCursor);
  const sceneRail = page.getByRole('complementary', { name: '课程场景' });
  await sceneRail.getByRole('button', { name: /小测验|知识检查/ }).first().click();
  await expect(page.getByText('用自己的话检查理解')).toBeVisible();
}

async function answerEveryQuizQuestion(page: import('@playwright/test').Page) {
  const submit = page.getByRole('button', { name: /^(提交答案|重新提交)$/ });
  const quizPanel = submit.locator('..');
  const questions = quizPanel.locator('section[class*="question"]');
  for (let index = 0; index < await questions.count(); index += 1) {
    const question = questions.nth(index);
    const textarea = question.locator('textarea');
    if (await textarea.count()) await textarea.fill(`我的推理步骤 ${index + 1}`);
    const radios = question.locator('input[type="radio"]');
    if (await radios.count()) await radios.first().check();
    const checkboxes = question.locator('input[type="checkbox"]');
    if (await checkboxes.count()) await checkboxes.first().check();
  }
}

test('discovers Chalk-owned classrooms through the authenticated backend without local history', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => localStorage.removeItem('chalkboard:history'));
  const records = await classroomRecords(page);
  expect(records.map((classroom) => classroom.title)).toEqual(expect.arrayContaining([
    '等式的性质与移项变号',
    '傅里叶变换入门',
  ]));
  await openClassroom(page);
  await expect(page.getByRole('navigation', { name: '课堂记录' }).getByRole('link')).toHaveCount(records.length);
});

test('renders classroom Notes without React list-key warnings', async ({ page }) => {
  const keyWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('Each child in a list should have a unique "key" prop')) {
      keyWarnings.push(message.text());
    }
  });

  await signIn(page);
  await openClassroom(page);
  await page.waitForTimeout(100);

  expect(keyWarnings).toEqual([]);
});

test('opens the real classroom workspace and completes core panel interactions', async ({ page }) => {
  await signIn(page);
  await page.route('**/learning-sessions/*/quiz-attempts', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ quizAttempts: [] }),
    });
  });
  await openClassroom(page);

  const firstShapePath = page.locator('[class*="canvasShape"] path').first();
  await expect(firstShapePath).toHaveAttribute('d', /\S+/);

  await page.getByRole('complementary', { name: '课程场景' }).getByRole('button', { name: /两边同时减去同一个数/ }).click();
  const classroomLine = page.locator('[class*="canvasLine"] > path').first();
  await expect(classroomLine).toHaveAttribute('d', /\S+/);
  await expect(classroomLine).toHaveAttribute('marker-end', /arrow/);

  await expect(page.getByRole('complementary', { name: '课程场景' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Notes' })).toBeVisible();
  await expect(page.getByRole('region', { name: '课堂讨论' })).toBeVisible();
  await expect(page.locator('[class*="sceneInteractiveThumbnail"] iframe')).toHaveCount(0);
  await expect(page.locator('[class*="sceneInteractivePreview"]')).toContainText('INTERACTIVE');
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

test('renders supported slide elements and exposes unsupported imported content', async ({ page }) => {
  await signIn(page);
  const now = new Date().toISOString();
  const summary = {
    id: 'rendering-classroom',
    title: '生成内容渲染检查',
    description: null,
    createdAt: now,
    updatedAt: now,
    latestArtifact: { id: 'rendering-artifact', version: 1, contentHash: 'rendering-hash', createdAt: now },
  };
  const cursor = {
    version: 1 as const,
    stageId: 'rendering-stage',
    sceneId: 'rendering-scene',
    sceneIndex: 0,
    actionIndex: 0,
    mode: 'idle' as const,
    completed: false,
  };
  await page.route('**/classrooms', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ classrooms: [summary] }),
  }));
  await page.route('**/classrooms/rendering-classroom/artifacts/rendering-artifact', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      ...summary,
      document: {
        stage: { id: 'rendering-stage', name: summary.title, createdAt: Date.now(), updatedAt: Date.now() },
        scenes: [{
          id: 'rendering-scene',
          stageId: 'rendering-stage',
          type: 'slide',
          title: '时域与频域',
          order: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          actions: [],
          content: {
            type: 'slide',
            canvas: {
              viewportSize: 1000,
              viewportRatio: 0.5625,
              elements: [
                {
                  id: 'generated-chart',
                  type: 'chart',
                  left: 60,
                  top: 80,
                  width: 420,
                  height: 220,
                  chartType: 'line',
                  data: { labels: ['0', '1', '2'], legends: ['幅度'], series: [[0, 1, 0]] },
                  themeColors: ['#5b9bd5'],
                },
                {
                  id: 'generated-formula',
                  type: 'latex',
                  left: 520,
                  top: 120,
                  width: 400,
                  height: 100,
                  latex: 'X(f) = \\int_{-\\infty}^{\\infty} x(t) e^{-j2\\pi ft} dt',
                },
                {
                  id: 'imported-code',
                  type: 'code',
                  left: 60,
                  top: 330,
                  width: 420,
                  height: 170,
                  language: 'python',
                  fileName: 'fourier.py',
                  showLineNumbers: true,
                  fontSize: 14,
                  lines: [
                    { id: 'line-1', content: 'def fft(signal):' },
                    { id: 'line-2', content: '    return transform(signal)' },
                  ],
                },
                {
                  id: 'future-element',
                  type: 'future-widget',
                  left: 520,
                  top: 330,
                  width: 400,
                  height: 90,
                },
              ],
            },
          },
        }],
      },
    }),
  }));
  await page.route('**/classrooms/rendering-classroom/artifacts/rendering-artifact/learning-session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      created: true,
      learningSession: { id: 'rendering-session', classroomId: summary.id, artifactId: summary.latestArtifact.id, cursor, revision: 1, createdAt: now, updatedAt: now },
    }),
  }));
  await page.route('**/learning-sessions/rendering-session/quiz-attempts', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ quizAttempts: [] }),
  }));

  await page.goto('/chalkboard?id=rendering-classroom');

  await expect(page.getByRole('heading', { name: summary.title })).toBeVisible();
  await expect(page.getByRole('img', { name: '折线图：幅度' }).last()).toBeVisible();
  await expect(page.locator('[class*="canvasLatexContent"] .katex').last()).toBeVisible();
  await expect(page.getByRole('figure', { name: '代码：fourier.py' }).last()).toContainText('def fft(signal):');
  await expect(page.getByText('暂不支持课件元素：future-widget').last()).toBeVisible();
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

test('uses browser speech for authored narration and exposes pause, resume, and cancel controls', async ({ page }) => {
  await page.addInitScript(() => {
    const calls = { cancel: 0, pause: 0, resume: 0, spoken: [] as Array<{ text: string; lang: string; rate: number; volume: number }> };
    class TestUtterance {
      lang = '';
      rate = 1;
      volume = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly text: string) {}
    }
    Object.defineProperty(window, '__chalkSpeechCalls', { value: calls });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: TestUtterance });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel: () => { calls.cancel += 1; },
        pause: () => { calls.pause += 1; },
        resume: () => { calls.resume += 1; },
        getVoices: () => [],
        speak: (utterance: TestUtterance) => {
          calls.spoken.push({ text: utterance.text, lang: utterance.lang, rate: utterance.rate, volume: utterance.volume });
        },
      },
    });
  });
  await signIn(page);
  await openClassroom(page);

  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __chalkSpeechCalls: { spoken: unknown[] } }).__chalkSpeechCalls.spoken.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __chalkSpeechCalls: { spoken: Array<{ text: string; lang: string; rate: number; volume: number }> } }).__chalkSpeechCalls.spoken[0])).toMatchObject({
    text: expect.any(String),
    lang: 'zh-CN',
    rate: 0.95,
    volume: 1,
  });

  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __chalkSpeechCalls: { pause: number } }).__chalkSpeechCalls.pause)).toBe(1);
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __chalkSpeechCalls: { resume: number } }).__chalkSpeechCalls.resume)).toBe(1);
  const cancelCount = await page.evaluate(() => (window as unknown as { __chalkSpeechCalls: { cancel: number } }).__chalkSpeechCalls.cancel);
  const spokenCount = await page.evaluate(() => (window as unknown as { __chalkSpeechCalls: { spoken: unknown[] } }).__chalkSpeechCalls.spoken.length);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __chalkSpeechCalls: { cancel: number } }).__chalkSpeechCalls.cancel)).toBeGreaterThan(cancelCount);
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __chalkSpeechCalls: { spoken: unknown[] } }).__chalkSpeechCalls.spoken.length)).toBe(spokenCount);
});

test('starts the lecture from the note paragraph selected by the learner', async ({ page }) => {
  await page.addInitScript(() => {
    const calls = { spoken: [] as string[] };
    class TestUtterance {
      lang = '';
      rate = 1;
      volume = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly text: string) {}
    }
    Object.defineProperty(window, '__chalkNoteSpeechCalls', { value: calls });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: TestUtterance });
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel: () => undefined,
        pause: () => undefined,
        resume: () => undefined,
        getVoices: () => [],
        speak: (utterance: TestUtterance) => calls.spoken.push(utterance.text),
      },
    });
  });
  await signIn(page);
  await openClassroom(page);

  const notes = page.getByRole('complementary', { name: '课堂侧栏' });
  const paragraphs = notes.getByRole('button', { name: /^从此处播放：/ });
  await expect(paragraphs).not.toHaveCount(0);
  const target = paragraphs.nth(2);
  await expect(target).toBeVisible();
  const accessibleName = await target.getAttribute('aria-label');
  expect(accessibleName).toBeTruthy();

  await target.click();

  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __chalkNoteSpeechCalls: { spoken: string[] } }
  ).__chalkNoteSpeechCalls.spoken[0])).toBe(accessibleName!.replace(/^从此处播放：/, ''));
  await expect(target).toHaveAttribute('aria-current', 'step');
});

test('retries a failed classroom request and restores the playback cursor after refresh', async ({ page }) => {
  await signIn(page);
  const records = await classroomRecords(page);
  const equationClassroomRecord = records.find((record) => record.title === '等式的性质与移项变号');
  expect(equationClassroomRecord).toBeDefined();
  await resetClassroomCursor(page, equationClassroomRecord!.id);

  let requestsShouldFail = true;
  await page.route('**/classrooms**', async (route) => {
    if (requestsShouldFail) {
      await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ success: false, error: '课堂服务暂时不可用' }) });
      return;
    }
    await route.continue();
  });

  await page.goto('/chalkboard');
  await expect(page.getByText('课堂暂时无法打开')).toBeVisible({ timeout: 15_000 });
  requestsShouldFail = false;
  await page.getByRole('button', { name: '重试' }).click();
  await expect(page.getByText('CHALKBOARD / PLAYBACK')).toBeVisible();
  const equationClassroom = page.getByRole('navigation', { name: '课堂记录' }).getByRole('link', { name: /等式的性质与移项变号/ });
  if (await page.getByRole('heading', { name: '等式的性质与移项变号' }).count() === 0) await equationClassroom.click();
  await expect(page.getByRole('heading', { name: '等式的性质与移项变号' })).toBeVisible();

  const cursorSaved = page.waitForResponse((response) => (
    response.request().method() === 'PUT'
    && /\/learning-sessions\/[^/]+\/cursor$/.test(new URL(response.url()).pathname)
    && response.ok()
  ));
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText('第 2 / 5 节', { exact: true })).toBeVisible();
  await cursorSaved;
  await expect(page.getByRole('status')).toContainText('进度已保存');
  await page.reload();
  await expect(page.getByText('第 2 / 5 节', { exact: true })).toBeVisible();
});

test('restores the same artifact cursor in a new authenticated browser context', async ({ page, browser }) => {
  await signIn(page);
  await openClassroom(page);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText(/第 2 页/)).toBeVisible();
  await expect(page.getByRole('status')).toContainText('进度已保存');

  const secondContext = await browser.newContext();
  try {
    const secondPage = await secondContext.newPage();
    await signIn(secondPage);
    await openClassroom(secondPage, '等式的性质与移项变号', false);
    await expect(secondPage.getByText(/第 2 页/)).toBeVisible();
  } finally {
    await secondContext.close();
  }
});

test('recovers the newer server cursor instead of overwriting it after a revision conflict', async ({ page }) => {
  await signIn(page);
  await openClassroom(page);
  const apiUrl = (process.env.E2E_API_URL ?? 'http://localhost:3001').replace('127.0.0.1', 'localhost');
  await page.evaluate(async (url) => {
    const records = (await (await fetch(`${url}/classrooms`, { credentials: 'include' })).json() as {
      classrooms: Array<{ id: string; title: string; latestArtifact: { id: string } }>;
    }).classrooms;
    const classroom = records.find((candidate) => candidate.title === '等式的性质与移项变号');
    if (!classroom) throw new Error('Seeded classroom was not found');
    const artifact = await (await fetch(
      `${url}/classrooms/${classroom.id}/artifacts/${classroom.latestArtifact.id}`,
      { credentials: 'include' },
    )).json() as { document: { stage: { id: string }; scenes: Array<{ id: string; order: number }> } };
    const session = (await (await fetch(
      `${url}/classrooms/${classroom.id}/artifacts/${classroom.latestArtifact.id}/learning-session`,
      { method: 'POST', credentials: 'include' },
    )).json() as { learningSession: { id: string; revision: number } }).learningSession;
    const scenes = [...artifact.document.scenes].sort((left, right) => left.order - right.order);
    const response = await fetch(`${url}/learning-sessions/${session.id}/cursor`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expectedRevision: session.revision,
        cursor: {
          version: 1,
          stageId: artifact.document.stage.id,
          sceneId: scenes[2]?.id,
          sceneIndex: 2,
          actionIndex: 0,
          mode: 'idle',
          completed: false,
        },
      }),
    });
    if (!response.ok) throw new Error(`Competing cursor save failed with ${response.status}`);
  }, apiUrl);

  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已恢复较新进度');
  await expect(page.getByText(/第 3 页/)).toBeVisible();
  await expect(page.getByText('检测到另一处设备保存了更新进度')).toBeVisible();
});

test('marks offline cursor changes as unsaved and retries after reconnecting', async ({ page }) => {
  await signIn(page);
  await openClassroom(page);
  await page.context().setOffline(true);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText(/第 2 页/)).toBeVisible();
  await expect(page.getByRole('status')).toContainText('离线 · 进度未保存');

  await page.context().setOffline(false);
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByText(/第 3 页/)).toBeVisible();
  await expect(page.getByRole('status')).toContainText('进度已保存');
});

test('restores a server-scored quiz attempt after refresh and in a new browser context', async ({ page, browser }) => {
  await signIn(page);
  await openQuizScene(page);
  await answerEveryQuizQuestion(page);
  await page.getByRole('button', { name: /^(提交答案|重新提交)$/ }).click();
  await expect(page.getByText(/已完成 · 得分 \d+ \/ \d+/)).toBeVisible();
  await expect(page.getByText('已保存，可以修改后再次提交。')).toBeVisible();

  await page.reload();
  await expect(page.getByText(/已完成 · 得分 \d+ \/ \d+/)).toBeVisible();

  const secondContext = await browser.newContext();
  try {
    const secondPage = await secondContext.newPage();
    await signIn(secondPage);
    await openQuizScene(secondPage, false);
    await expect(secondPage.getByText(/已完成 · 得分 \d+ \/ \d+/)).toBeVisible();
  } finally {
    await secondContext.close();
  }
});

test('keeps quiz answers recoverable across offline failure and revision conflict', async ({ page }) => {
  await signIn(page);
  await openQuizScene(page);
  await answerEveryQuizQuestion(page);

  await page.context().setOffline(true);
  await page.getByRole('button', { name: /^(提交答案|重新提交)$/ }).click();
  await expect(page.getByText('当前离线，答案尚未保存')).toBeVisible();
  await page.context().setOffline(false);
  await page.getByRole('button', { name: /^(提交答案|重新提交)$/ }).click();
  await expect(page.getByText('已保存，可以修改后再次提交。')).toBeVisible();

  const apiUrl = (process.env.E2E_API_URL ?? 'http://localhost:3001').replace('127.0.0.1', 'localhost');
  await page.evaluate(async (url) => {
    const records = (await (await fetch(`${url}/classrooms`, { credentials: 'include' })).json() as {
      classrooms: Array<{ id: string; title: string; latestArtifact: { id: string } }>;
    }).classrooms;
    const classroom = records.find((candidate) => candidate.title === '等式的性质与移项变号');
    if (!classroom) throw new Error('Seeded classroom was not found');
    const session = (await (await fetch(
      `${url}/classrooms/${classroom.id}/artifacts/${classroom.latestArtifact.id}/learning-session`,
      { method: 'POST', credentials: 'include' },
    )).json() as { learningSession: { id: string } }).learningSession;
    const attempts = (await (await fetch(
      `${url}/learning-sessions/${session.id}/quiz-attempts`,
      { credentials: 'include' },
    )).json() as {
      quizAttempts: Array<{ sceneId: string; revision: number; answers: Record<string, string[]> }>;
    }).quizAttempts;
    const attempt = attempts[0];
    if (!attempt) throw new Error('Quiz attempt was not found');
    const response = await fetch(
      `${url}/learning-sessions/${session.id}/quiz-attempts/${encodeURIComponent(attempt.sceneId)}`,
      {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: attempt.revision, answers: attempt.answers }),
      },
    );
    if (!response.ok) throw new Error(`Competing quiz save failed with ${response.status}`);
  }, apiUrl);

  await page.getByRole('button', { name: '重新提交' }).click();
  await expect(page.getByText('检测到其他设备保存了更新答案')).toBeVisible();
  await expect(page.getByText('当前显示已保存的最新答案。')).toBeVisible();
});

test('keeps playback controls and interactive widgets without exposing a student whiteboard', async ({ page }) => {
  await signIn(page);
  await openClassroom(page, '傅里叶变换入门');
  await page.evaluate(() => localStorage.removeItem('chalkboard:cursor:681PbzeDfm'));
  await page.reload();
  await expect(page.getByText('CHALKBOARD / PLAYBACK')).toBeVisible();

  const speed = page.getByRole('button', { name: /播放速度/ }).first();
  await expect(speed).toHaveAttribute('aria-label', '播放速度 1 倍');
  await speed.click();
  await expect(speed).toHaveAttribute('aria-label', '播放速度 1.25 倍');

  await expect(page.getByRole('button', { name: '打开白板' })).toHaveCount(0);
  await expect(page.getByRole('img', { name: '可书写白板' })).toHaveCount(0);

  await page.getByRole('button', { name: '信号合成实验室' }).click();
  await expect(page.getByLabel('聚光').first()).toBeVisible();
  await expect(page.getByLabel('互动状态').first()).toBeVisible();
  const frame = page.locator('[class*="interactiveFrameWrap"] iframe');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
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

test('adapts the classroom to a phone viewport without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await openClassroom(page);
  await expect(page.getByRole('heading', { name: '等式的性质与移项变号' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('complementary', { name: '课程场景' })).toBeVisible();
  await expect(page.getByRole('button', { name: '展开侧栏' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.getByRole('button', { name: '展开侧栏' }).click();
  await expect(page.getByRole('tab', { name: 'Notes' })).toBeVisible();
  await page.getByRole('button', { name: '收起侧栏' }).click();
  await expect(page.getByRole('button', { name: '播放', exact: true })).toBeVisible();
});

test('plays an authored video in the active lesson viewport', async ({ page }) => {
  await signIn(page);
  await openClassroom(page, '傅里叶变换入门');
  const records = await classroomRecords(page);
  const classroom = records.find((record) => record.title === '傅里叶变换入门');
  expect(classroom).toBeDefined();
  await resetClassroomCursor(page, classroom!.id, {
    sceneIndex: 7,
    actionIndex: 6,
    mode: 'paused',
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

test('scopes server-backed classroom records by surface and merges them on Chats', async ({ page }) => {
  await signIn(page);
  await page.evaluate(() => localStorage.removeItem('chalkboard:history'));
  const records = await classroomRecords(page);
  await openClassroom(page, '傅里叶变换入门');
  await expect(page.getByRole('region', { name: '最近课堂' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '课堂记录' }).getByRole('link')).toHaveCount(records.length);
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
  await page.evaluate(() => localStorage.removeItem('chalkboard:history'));
  await openClassroom(page);
  const target = page.getByRole('navigation', { name: '课堂记录' }).getByRole('link', { name: /傅里叶变换入门/ });
  await expect(target).toHaveAttribute('href', /\/chalkboard\?id=[0-9a-f-]{36}$/);
  await target.click();
  await expect(page).toHaveURL(/\/chalkboard\?id=[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: '傅里叶变换入门' })).toBeVisible();
  await expect(page.locator('[class*="participantAvatar"] img')).toHaveCount(0);
  await expect(page.locator('[class*="participantAvatar"]')).not.toHaveCount(0);
});

test('imports a classroom archive and opens the returned Classroom Artifact', async ({ page }) => {
  await signIn(page);
  const records = await classroomRecords(page);
  const fourier = records.find((record) => record.title === '傅里叶变换入门');
  expect(fourier).toBeDefined();
  await openClassroom(page);

  let uploadedFilename = '';
  await page.route('**/classrooms/import', async (route) => {
    uploadedFilename = route.request().postData() ?? '';
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ classroom: { id: fourier!.id } }),
    });
  });
  await page.getByLabel('选择课堂归档').setInputFiles({
    name: '函数入门.chalk.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('e2e archive bytes'),
  });

  await expect(page).toHaveURL(new RegExp(`/chalkboard\\?id=${fourier!.id}$`));
  await expect(page.getByRole('heading', { name: '傅里叶变换入门' })).toBeVisible();
  expect(uploadedFilename).toContain('函数入门.chalk.zip');
});

test('restores an unfinished Generation Run after refresh', async ({ page }) => {
  await signIn(page);
  const outline = {
    languageDirective: '使用简体中文教学。',
    courseTitle: '加减综合练习',
    outlines: [{
      id: 'scene_1',
      type: 'interactive',
      title: '加减综合练习乐园',
      description: '通过互动练习巩固加减法。',
      keyPoints: ['加法', '减法'],
      order: 1,
    }],
  };
  const failedRun = {
    id: '00000000-0000-4000-8000-000000000301',
    draftId: '00000000-0000-4000-8000-000000000302',
    stage: 'scene_content',
    status: 'failed',
    attempt: 2,
    requirements: '生成一堂加减法练习课',
    context: {},
    prompt: null,
    model: null,
    outline,
    scenes: [{
      id: '00000000-0000-4000-8000-000000000303',
      outlineId: 'scene_1',
      type: 'interactive',
      order: 1,
      outline: outline.outlines[0],
      content: null,
      actions: null,
      status: 'failed',
      attempt: 1,
      prompt: { id: 'classroom-interactive-content', revision: 'e'.repeat(64) },
      model: { providerId: 'deepseek', modelId: 'deepseek-chat' },
      error: { code: 'CLASSROOM_INTERACTIVE_CONTENT_INCOMPLETE' },
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    }],
    mediaTasks: [],
    progress: { total: 1, completed: 0, failed: 1, currentSceneId: null },
    error: { code: 'CLASSROOM_INTERACTIVE_CONTENT_INCOMPLETE' },
    cancelRequested: false,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
  await page.route('**/classroom-generation-runs/current', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ generationRun: failedRun }),
  }));

  await page.goto('/chalkboard');
  const continueGeneration = page.getByRole('button', { name: '继续课堂生成' });
  await expect(continueGeneration).toBeVisible();
  await continueGeneration.click();
  await expect(page.getByRole('heading', { name: '加减综合练习' })).toBeVisible();
  await expect(page.getByText('互动页面没有完整结束，模型返回可能不完整；重试只会补生成这个场景。')).toBeVisible();
  await expect(page.getByRole('button', { name: '补生成未完成场景' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: '继续课堂生成' })).toBeVisible();
});

test('keeps the primary action visible in a long classroom generation panel', async ({ page }) => {
  await page.setViewportSize({ width: 1365, height: 640 });
  await signIn(page);
  const outlines = Array.from({ length: 12 }, (_, index) => ({
    id: `scene_${index + 1}`,
    type: index % 4 === 2 ? 'interactive' : index % 4 === 3 ? 'quiz' : 'slide',
    title: `课堂场景 ${index + 1}`,
    description: `这是第 ${index + 1} 个课堂场景的说明，用于覆盖内容较长时的媒体发布入口。`,
    keyPoints: [`知识点 ${index + 1}`, `练习要点 ${index + 1}`],
    order: index + 1,
  }));
  const now = new Date().toISOString();
  const completedMediaRun = {
    id: '00000000-0000-4000-8000-000000000401',
    draftId: '00000000-0000-4000-8000-000000000402',
    stage: 'media_tasks',
    status: 'completed',
    attempt: 1,
    requirements: '生成一堂包含多个场景和媒体的课堂',
    context: {},
    prompt: null,
    model: null,
    outline: { languageDirective: '使用简体中文教学。', courseTitle: '长课堂媒体发布检查', outlines },
    scenes: outlines.map((outline, index) => ({
      id: `00000000-0000-4000-8000-${String(500 + index).padStart(12, '0')}`,
      outlineId: outline.id,
      type: outline.type,
      order: outline.order,
      outline,
      content: { type: outline.type },
      actions: [{ id: `action_${index + 1}`, type: 'speech', text: `讲解第 ${index + 1} 个场景。` }],
      status: 'completed',
      attempt: 1,
      prompt: null,
      model: { providerId: 'deepseek', modelId: 'deepseek-v4-flash' },
      error: null,
      startedAt: now,
      finishedAt: now,
    })),
    mediaTasks: [{
      id: '00000000-0000-4000-8000-000000000499',
      sceneId: '00000000-0000-4000-8000-000000000500',
      actionId: null,
      elementId: 'gen_img_1',
      providerTaskId: null,
      kind: 'image',
      status: 'completed',
      attempt: 1,
      providerId: 'seedream',
      modelId: 'doubao-seedream-4-5-251128',
      mediaRef: 'media/generated/image-1',
      contentType: 'image/jpeg',
      size: 1024,
      error: null,
      startedAt: now,
      finishedAt: now,
    }],
    progress: { total: 1, completed: 1, failed: 0, currentSceneId: null },
    error: null,
    cancelRequested: false,
    startedAt: now,
    finishedAt: now,
  };
  await page.route('**/classroom-generation-runs/current', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ generationRun: completedMediaRun }),
  }));

  await page.goto('/chalkboard');
  await page.getByRole('button', { name: '继续课堂生成' }).click();
  const dialog = page.getByRole('dialog');
  const publish = page.getByRole('button', { name: '校验并发布课堂' });

  await expect(publish).toBeInViewport();
  await dialog.hover();
  await page.mouse.wheel(0, 50_000);
  await expect(publish).toBeInViewport();
  await page.mouse.wheel(0, -50_000);
  await expect(publish).toBeInViewport();
});

test('polls Generation Runs, publishes the completed draft, and opens its artifact', async ({ page }) => {
  await signIn(page);
  const outlineRunId = '00000000-0000-4000-8000-000000000101';
  const contentRunId = '00000000-0000-4000-8000-000000000103';
  const actionsRunId = '00000000-0000-4000-8000-000000000104';
  const mediaRunId = '00000000-0000-4000-8000-000000000105';
  const publishedClassroomId = '00000000-0000-4000-8000-000000000106';
  const publishedArtifactId = '00000000-0000-4000-8000-000000000107';
  const generatedInteractiveHtml = `<!DOCTYPE html><html lang="zh-CN"><body>
    <button id="main-control" type="button">调整斜率</button>
    <output id="result-display">斜率尚未设置</output>
    <script type="application/json" id="widget-config">{"type":"simulation","concept":"linear_slope"}</script>
    <script>
      window.addEventListener('message', function (event) {
        var data = event.data || {};
        if (data.type === 'SET_WIDGET_STATE') document.getElementById('result-display').textContent = '斜率 = ' + data.state.slope;
        if (data.type === 'HIGHLIGHT_ELEMENT') document.getElementById('main-control').focus();
        if (data.type === 'ANNOTATE_ELEMENT') document.getElementById('result-display').dataset.annotated = 'true';
        if (data.type === 'REVEAL_ELEMENT') document.getElementById('result-display').hidden = false;
      });
    </script>
  </body></html>`;
  const outline = {
    languageDirective: '使用简体中文教学。',
    courseTitle: '勾股定理入门',
    outlines: [
      { id: 'scene_1', type: 'slide', title: '认识直角三角形', description: '建立直观认识。', keyPoints: ['直角边', '斜边'], order: 1 },
      { id: 'scene_2', type: 'quiz', title: '检查边长关系', description: '检查理解。', keyPoints: ['识别斜边'], order: 2, quizConfig: { questionCount: 1, difficulty: 'easy', questionTypes: ['single'] } },
      { id: 'scene_3', type: 'interactive', title: '探索斜率变化', description: '调整状态观察图像。', keyPoints: ['调整斜率', '观察变化'], order: 3, widgetType: 'simulation', widgetOutline: { concept: 'linear_slope', keyVariables: ['slope'] } },
    ],
  };
  const run = (overrides: Record<string, unknown>) => ({
    id: outlineRunId,
    draftId: '00000000-0000-4000-8000-000000000102',
    stage: 'outline',
    status: 'queued',
    attempt: 1,
    requirements: '请为初一学生生成一堂勾股定理入门课',
    context: {},
    prompt: { id: 'classroom-outline', revision: 'a'.repeat(64) },
    model: null,
    outline: null,
    scenes: [],
    mediaTasks: [],
    progress: null,
    error: null,
    cancelRequested: false,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  });
  let outlinePolls = 0;
  let contentPolls = 0;
  let actionsPolls = 0;
  let mediaPolls = 0;
  let published = false;
  const publishedSummary = {
    id: publishedClassroomId,
    title: '勾股定理入门',
    description: '请为初一学生生成一堂勾股定理入门课',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    latestArtifact: { id: publishedArtifactId, version: 1, contentHash: 'd'.repeat(64), createdAt: new Date().toISOString() },
  };
  await page.route('**/classrooms**', async (route) => {
    if (!published) return route.fallback();
    const path = new URL(route.request().url()).pathname;
    if (path === '/classrooms') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ classrooms: [publishedSummary] }) });
    }
    if (path === `/classrooms/${publishedClassroomId}/artifacts/${publishedArtifactId}`) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...publishedSummary,
          document: {
            stage: { id: 'published-pythagorean', name: '勾股定理入门', createdAt: Date.now(), updatedAt: Date.now() },
            scenes: [
              {
                id: 'scene_1', stageId: 'published-pythagorean', type: 'slide', title: '认识直角三角形', order: 1,
                content: { type: 'slide', canvas: { elements: [{ id: 'heading', type: 'text', content: '勾股定理' }] } },
                actions: [{ id: 'action_1', type: 'speech', text: '先观察直角三角形。' }],
              },
              {
                id: 'scene_2', stageId: 'published-pythagorean', type: 'quiz', title: '检查边长关系', order: 2,
                content: { type: 'quiz', questions: [{ id: 'q1', type: 'single', question: '哪一条是斜边？', options: [{ value: 'a', label: '直角对边' }], answer: ['a'] }] },
                actions: [{ id: 'action_2', type: 'speech', text: '现在独立判断。' }],
              },
              {
                id: 'scene_3', stageId: 'published-pythagorean', type: 'interactive', title: '探索斜率变化', order: 3,
                content: { type: 'interactive', url: '', html: generatedInteractiveHtml, widgetType: 'simulation', widgetConfig: { type: 'simulation', concept: 'linear_slope' } },
                actions: [{ id: 'action_3', type: 'widget_setState', state: { slope: 2 } }],
              },
            ],
          },
        }),
      });
    }
    if (path === `/classrooms/${publishedClassroomId}/artifacts/${publishedArtifactId}/learning-session`) {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          created: true,
          learningSession: {
            id: '00000000-0000-4000-8000-000000000108',
            classroomId: publishedClassroomId,
            artifactId: publishedArtifactId,
            revision: 1,
            cursor: {
              version: 1,
              stageId: 'published-pythagorean',
              sceneId: 'scene_1',
              sceneIndex: 0,
              actionIndex: 0,
              mode: 'idle',
              completed: false,
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
      });
    }
    return route.fallback();
  });
  await page.route('**/media/providers', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      tts: [{
        capability: 'tts', id: 'openai', name: 'OpenAI TTS', defaultBaseUrl: 'https://api.openai.com/v1',
        models: [{ id: 'gpt-4o-mini-tts', name: 'GPT-4o Mini TTS' }], defaultModel: 'gpt-4o-mini-tts',
        baseUrl: 'https://api.openai.com/v1', configured: true, requiresApiKey: true,
        voices: ['alloy', 'coral'], formats: ['mp3'], settings: { modelId: 'gpt-4o-mini-tts' },
      }],
      asr: [], image: [{
        capability: 'image', id: 'seedream', name: 'Seedream', defaultBaseUrl: 'https://ark.cn-beijing.volces.com',
        models: [
          { id: 'doubao-seedream-4-0-250828', name: 'Seedream 4.0' },
          { id: 'doubao-seedream-4-5-251128', name: 'Seedream 4.5' },
        ], defaultModel: 'doubao-seedream-4-0-250828', baseUrl: 'https://ark.cn-beijing.volces.com',
        configured: true, requiresApiKey: true, aspectRatios: ['16:9', '4:3', '1:1'],
      }, {
        capability: 'image', id: 'openai', name: 'OpenAI Image', defaultBaseUrl: 'https://api.openai.com/v1',
        models: [{ id: 'gpt-image-1.5', name: 'GPT Image 1.5' }], defaultModel: 'gpt-image-1.5',
        baseUrl: 'https://api.openai.com/v1', configured: false, requiresApiKey: true, aspectRatios: ['1:1'],
      }], video: [{
        capability: 'video', id: 'seedance', name: 'Seedance', defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        models: [
          { id: 'doubao-seedance-1-0-pro-250528', name: 'Doubao Seedance 1.0 Pro' },
          { id: 'doubao-seedance-1-5-pro-251215', name: 'Doubao Seedance 1.5 Pro' },
        ], defaultModel: 'doubao-seedance-1-0-pro-250528', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        configured: true, requiresApiKey: true, aspectRatios: ['16:9'], durations: [5], resolutions: ['480p', '720p', '1080p'],
        settings: { modelId: 'doubao-seedance-1-0-pro-250528' },
      }, {
        capability: 'video', id: 'grok', name: 'Grok Video', defaultBaseUrl: 'https://api.x.ai/v1',
        models: [{ id: 'grok-imagine-video', name: 'Grok Imagine Video' }], defaultModel: 'grok-imagine-video',
        baseUrl: 'https://api.x.ai/v1', configured: true, requiresApiKey: true,
        aspectRatios: ['16:9'], durations: [6], resolutions: ['720p'],
      }, {
        capability: 'video', id: 'sora', name: 'Sora', defaultBaseUrl: 'https://api.openai.com/v1',
        models: [{ id: 'sora-2', name: 'Sora 2' }], defaultModel: 'sora-2',
        baseUrl: 'https://api.openai.com/v1', configured: false, requiresApiKey: true,
        aspectRatios: ['16:9'], durations: [8], resolutions: ['720p'],
      }],
    }),
  }));
  await page.route('**/settings/capabilities', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      image: { providerId: 'seedream', modelId: 'doubao-seedream-4-0-250828' },
      video: {
        providerId: 'seedance',
        modelId: 'doubao-seedance-1-0-pro-250528',
        durationSeconds: 5,
        resolution: '720p',
      },
      speech: { adapter: 'browser', language: 'zh-CN', voiceUri: null, rate: 0.95, volume: 1 },
    }),
  }));
  await page.route('**/classroom-generation-runs**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    let generationRun: Record<string, unknown>;
    if (request.method() === 'GET' && path === '/classroom-generation-runs/current') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ generationRun: null }),
      });
      return;
    } else if (request.method() === 'POST' && path === '/classroom-generation-runs') {
      const payload = request.postDataJSON() as {
        requirements: string;
        media?: {
          image?: { providerId?: string; model?: string };
          video?: { providerId?: string; model?: string; resolution?: string; durationSeconds?: number };
        };
      };
      expect(payload.requirements).toContain('勾股定理');
      expect(payload.media).toEqual({
        image: { providerId: 'seedream', model: 'doubao-seedream-4-5-251128', aspectRatio: '16:9' },
        video: { providerId: 'grok', model: 'grok-imagine-video', aspectRatio: '16:9', durationSeconds: 6, resolution: '720p' },
      });
      generationRun = run({});
    } else if (request.method() === 'GET' && path.endsWith(`/${outlineRunId}`)) {
      outlinePolls += 1;
      if (outlinePolls === 1) {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Temporary polling failure', code: 'TEMPORARY_FAILURE' }),
        });
        return;
      }
      generationRun = run({
        status: 'completed',
        model: { providerId: 'deepseek', modelId: 'deepseek-chat' },
        outline,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      });
    } else if (request.method() === 'POST' && path.endsWith(`/${outlineRunId}/scene-content`)) {
      generationRun = run({
        id: contentRunId,
        stage: 'scene_content',
        status: 'queued',
        prompt: null,
        outline,
        scenes: outline.outlines.map((scene, index) => ({
          id: `00000000-0000-4000-8000-00000000020${index}`,
          outlineId: scene.id,
          type: scene.type,
          order: scene.order,
          outline: scene,
          content: null,
          status: 'pending',
          attempt: 0,
          prompt: null,
          model: null,
          error: null,
          startedAt: null,
          finishedAt: null,
        })),
        progress: { total: 3, completed: 0, failed: 0, currentSceneId: null },
      });
    } else if (request.method() === 'GET' && path.endsWith(`/${contentRunId}`)) {
      contentPolls += 1;
      generationRun = run({
        id: contentRunId,
        stage: 'scene_content',
        status: contentPolls >= 2 ? 'completed' : 'running',
        prompt: null,
        outline,
        scenes: outline.outlines.map((scene, index) => ({
          id: `00000000-0000-4000-8000-00000000020${index}`,
          outlineId: scene.id,
          type: scene.type,
          order: scene.order,
          outline: scene,
          content: contentPolls >= 2 || index === 0 ? { type: scene.type } : null,
          status: contentPolls >= 2 || index === 0 ? 'completed' : 'running',
          attempt: 1,
          prompt: { id: `classroom-${scene.type}-content`, revision: 'b'.repeat(64) },
          model: { providerId: 'deepseek', modelId: 'deepseek-chat' },
          error: null,
          startedAt: new Date().toISOString(),
          finishedAt: contentPolls >= 2 || index === 0 ? new Date().toISOString() : null,
        })),
        progress: {
          total: 3,
          completed: contentPolls >= 2 ? 3 : 1,
          failed: 0,
          currentSceneId: contentPolls >= 2 ? null : 'scene_2',
        },
        startedAt: new Date().toISOString(),
        finishedAt: contentPolls >= 2 ? new Date().toISOString() : null,
      });
    } else if (request.method() === 'POST' && path.endsWith(`/${contentRunId}/scene-actions`)) {
      generationRun = run({
        id: actionsRunId,
        stage: 'scene_actions',
        status: 'queued',
        prompt: null,
        outline,
        scenes: outline.outlines.map((scene, index) => ({
          id: `00000000-0000-4000-8000-00000000020${index}`,
          outlineId: scene.id,
          type: scene.type,
          order: scene.order,
          outline: scene,
          content: { type: scene.type },
          actions: null,
          status: 'pending',
          attempt: 0,
          prompt: null,
          model: null,
          error: null,
          startedAt: null,
          finishedAt: null,
        })),
        progress: { total: 3, completed: 0, failed: 0, currentSceneId: null },
      });
    } else if (request.method() === 'GET' && path.endsWith(`/${actionsRunId}`)) {
      actionsPolls += 1;
      generationRun = run({
        id: actionsRunId,
        stage: 'scene_actions',
        status: actionsPolls >= 2 ? 'completed' : 'running',
        prompt: null,
        outline,
        scenes: outline.outlines.map((scene, index) => ({
          id: `00000000-0000-4000-8000-00000000020${index}`,
          outlineId: scene.id,
          type: scene.type,
          order: scene.order,
          outline: scene,
          content: { type: scene.type },
          actions: actionsPolls >= 2 || index === 0
            ? [{ id: `action_${index}`, type: 'speech', text: '课堂讲解' }]
            : null,
          status: actionsPolls >= 2 || index === 0 ? 'completed' : 'running',
          attempt: 1,
          prompt: { id: `classroom-${scene.type}-actions`, revision: 'c'.repeat(64) },
          model: { providerId: 'deepseek', modelId: 'deepseek-chat' },
          error: null,
          startedAt: new Date().toISOString(),
          finishedAt: actionsPolls >= 2 || index === 0 ? new Date().toISOString() : null,
        })),
        progress: {
          total: 3,
          completed: actionsPolls >= 2 ? 3 : 1,
          failed: 0,
          currentSceneId: actionsPolls >= 2 ? null : 'scene_2',
        },
        startedAt: new Date().toISOString(),
        finishedAt: actionsPolls >= 2 ? new Date().toISOString() : null,
      });
    } else if (request.method() === 'POST' && path.endsWith(`/${actionsRunId}/media-tasks`)) {
      expect(request.postDataJSON()).toEqual({});
      generationRun = run({
        id: mediaRunId,
        stage: 'media_tasks',
        status: 'queued',
        prompt: null,
        outline,
        scenes: outline.outlines.map((scene, index) => ({
          id: `00000000-0000-4000-8000-00000000020${index}`,
          outlineId: scene.id,
          type: scene.type,
          order: scene.order,
          outline: scene,
          content: { type: scene.type },
          actions: [{ id: `action_${index}`, type: 'speech', text: '课堂讲解' }],
          status: 'completed', attempt: 1, prompt: null, model: null, error: null,
          startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        })),
        mediaTasks: [],
        progress: { total: 0, completed: 0, failed: 0, currentSceneId: null },
      });
    } else if (request.method() === 'GET' && path.endsWith(`/${mediaRunId}`)) {
      mediaPolls += 1;
      const complete = mediaPolls >= 2;
      generationRun = run({
        id: mediaRunId,
        stage: 'media_tasks',
        status: complete ? 'completed' : 'running',
        prompt: null,
        outline,
        scenes: outline.outlines.map((scene, index) => ({
          id: `00000000-0000-4000-8000-00000000020${index}`,
          outlineId: scene.id, type: scene.type, order: scene.order, outline: scene,
          content: { type: scene.type },
          actions: [{ id: `action_${index}`, type: 'speech', text: '课堂讲解' }],
          status: 'completed', attempt: 1, prompt: null, model: null, error: null,
          startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
        })),
        mediaTasks: [],
        progress: { total: 0, completed: 0, failed: 0, currentSceneId: null },
        startedAt: new Date().toISOString(), finishedAt: complete ? new Date().toISOString() : null,
      });
    } else if (request.method() === 'POST' && path.endsWith(`/${mediaRunId}/publish`)) {
      published = true;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ created: true, classroom: publishedSummary }),
      });
      return;
    } else {
      return route.fallback();
    }
    await route.fulfill({
      status: request.method() === 'GET' ? 200 : 202,
      contentType: 'application/json',
      body: JSON.stringify({ generationRun }),
    });
  });
  await page.route(`**/learning-sessions/00000000-0000-4000-8000-000000000108/quiz-attempts`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ quizAttempts: [] }),
    });
  });

  await page.goto('/chalkboard');
  const openGeneration = page.getByRole('button', { name: '生成课堂' });
  await openGeneration.click();
  await expect(page.getByLabel('课堂要求')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(openGeneration).toBeFocused();
  await openGeneration.click();
  const closeGeneration = page.getByRole('button', { name: '关闭课堂生成' });
  await closeGeneration.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: '生成大纲' })).toBeFocused();
  const imageProvider = page.getByRole('combobox', { name: '图片 Provider' });
  const imageModel = page.getByRole('combobox', { name: '图片模型' });
  await expect(imageProvider).toHaveValue('seedream');
  await expect(imageProvider.locator('option')).toHaveText(['Seedream']);
  await expect(imageModel).toHaveValue('doubao-seedream-4-0-250828');
  await page.getByRole('checkbox', { name: '生成图片' }).check();
  await imageModel.selectOption('doubao-seedream-4-5-251128');

  const videoProvider = page.getByRole('combobox', { name: '视频 Provider' });
  const videoModel = page.getByRole('combobox', { name: '视频模型' });
  await expect(videoProvider).toHaveValue('seedance');
  await expect(videoProvider.locator('option')).toHaveText(['Seedance', 'Grok Video']);
  await videoProvider.selectOption('grok');
  await expect(videoModel).toHaveValue('grok-imagine-video');
  await expect(page.getByRole('checkbox', { name: '生成视频' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: '生成视频' }).check();
  await page.getByLabel('课堂要求').fill('请为初一学生生成一堂勾股定理入门课');
  await page.getByRole('button', { name: '生成大纲' }).click();
  await expect(page.getByText('任务已进入队列')).toBeVisible();
  await page.getByRole('button', { name: '关闭面板' }).click();
  await expect(page.getByRole('button', { name: '课堂生成中' })).toBeVisible();
  await page.getByRole('button', { name: '课堂生成中' }).click();

  await expect(page.getByRole('heading', { name: '勾股定理入门' })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('认识直角三角形')).toBeVisible();
  await expect(page.getByText('检查边长关系')).toBeVisible();
  await page.getByRole('button', { name: '逐场景生成内容' }).click();
  await expect(page.getByRole('region', { name: '课堂内容生成进度' })).toContainText('0 / 3');
  await expect(page.getByRole('region', { name: '课堂内容生成进度' })).toContainText('3 / 3', { timeout: 5_000 });
  await expect(page.getByText('场景内容已保存')).toBeVisible();
  await expect(page.getByText('当前已完成 slide、quiz 和 interactive 内容；下一步可以逐场景生成教师动作。')).toBeVisible();
  await page.getByRole('button', { name: '逐场景生成动作' }).click();
  await expect(page.getByRole('region', { name: '课堂动作生成进度' })).toContainText('0 / 3');
  await expect(page.getByRole('region', { name: '课堂动作生成进度' })).toContainText('3 / 3', { timeout: 5_000 });
  await expect(page.getByText('课堂动作已保存')).toBeVisible();
  await expect(page.getByText('slide、quiz 和 interactive 的内容与教师动作已保存；媒体、最终校验和课堂发布尚未开始。')).toBeVisible();
  await expect(page.getByLabel('语音 Provider')).toHaveCount(0);
  await expect(page.getByLabel('教师声音')).toHaveCount(0);
  await page.getByRole('button', { name: '确认课堂媒体' }).click();
  await expect(page.getByRole('region', { name: '课堂媒体生成进度' })).toContainText('0 / 0');
  await expect(page.getByRole('region', { name: '课堂媒体生成进度' })).toContainText('未规划额外图片或视频，媒体阶段无需生成内容。');
  await expect(page.getByText('课堂媒体已保存')).toBeVisible();
  await expect(page.locator('footer').getByText('课堂没有规划额外图片或视频，可以继续校验并发布。')).toBeVisible();
  await page.getByRole('button', { name: '校验并发布课堂' }).click();
  await expect(page).toHaveURL(new RegExp(`/chalkboard\\?id=${publishedClassroomId}$`));
  await expect(page.getByRole('heading', { name: '勾股定理入门' })).toBeVisible();
  await expect(page.getByText('CHALKBOARD / PLAYBACK')).toBeVisible();
  await page.getByRole('button', { name: /探索斜率变化/ }).click();
  const generatedFrame = page.locator('[class*="interactiveFrameWrap"] iframe');
  const generatedFrameContent = await generatedFrame.contentFrame();
  expect(generatedFrameContent).not.toBeNull();
  if (generatedFrameContent) {
    await expect(generatedFrameContent.locator('#result-display')).toHaveText('斜率尚未设置');
    await page.getByRole('button', { name: '播放', exact: true }).click();
    await expect(generatedFrameContent.locator('#result-display')).toHaveText('斜率 = 2');
  }
});
