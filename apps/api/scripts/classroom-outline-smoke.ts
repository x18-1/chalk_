import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hash } from 'bcryptjs';
import { config as loadDotenv } from 'dotenv';
import { eq } from 'drizzle-orm';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
loadDotenv({ path: resolve(repositoryRoot, '.env') });

if (!process.env.DEEPSEEK_API_KEY) {
  console.error('DEEPSEEK_API_KEY is required for the classroom outline smoke test');
  process.exit(2);
}

const [{ buildApi }, { loadConfig }, { closeDb, getDb }, { authUsers }] = await Promise.all([
  import('../src/app'),
  import('../src/config'),
  import('../src/db/client'),
  import('../src/db/schema'),
]);

const suffix = randomUUID();
const email = `classroom-outline-smoke-${suffix}@chalk.local`;
const password = `smoke-${suffix}`;
const db = getDb();
let app: Awaited<ReturnType<typeof buildApi>> | undefined;
let userId: string | undefined;

try {
  const users = await db.insert(authUsers).values({
    email,
    name: '课堂大纲冒烟测试',
    role: 'user',
    passwordHash: await hash(password, 4),
  }).returning({ id: authUsers.id });
  userId = users[0]!.id;

  app = await buildApi({
    config: loadConfig({
      ...process.env,
      NODE_ENV: 'test',
      SESSION_COOKIE_NAME: `classroom_outline_smoke_${suffix}`,
      SESSION_COOKIE_SECURE: 'false',
    }),
    classroomGenerationWorker: { pollIntervalMs: 25 },
  });

  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
  });
  if (login.statusCode !== 200) throw new Error(`Smoke login failed with HTTP ${login.statusCode}`);
  const cookieHeader = login.headers['set-cookie'];
  const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)?.split(';', 1)[0];
  if (!cookie) throw new Error('Smoke login did not return a session cookie');

  const response = await app.inject({
    method: 'POST',
    url: '/classroom-generation-runs',
    headers: { cookie },
    payload: {
      requirements: '为初一学生设计一堂 10 分钟的勾股定理入门课。必须恰好生成三个场景：第一个是 slide，第二个是只有一道单选题的 quiz，第三个是用滑块改变直角三角形边长的 simulation interactive；不要生成 pbl。',
      context: { sourceText: '学生已经认识直角三角形，尚未系统学习平方与平方根。' },
    },
  });
  if (response.statusCode !== 202) {
    throw new Error(`Outline request failed with HTTP ${response.statusCode}: ${response.body}`);
  }

  const created = response.json() as { generationRun?: { id?: string } };
  if (!created.generationRun?.id) throw new Error('Outline request did not return a Generation Run ID');
  const run = await waitForRun(app, cookie, created.generationRun.id, 180_000);
  if (run?.status !== 'completed' || !run.outline?.courseTitle || !run.outline.outlines?.length) {
    throw new Error(`Outline generation did not complete: ${run?.error?.code ?? run?.status ?? 'missing response'}`);
  }
  if (run.model?.providerId !== 'deepseek') {
    throw new Error(`Expected DeepSeek, received ${run.model?.providerId ?? 'no provider'}`);
  }

  const contentResponse = await app.inject({
    method: 'POST',
    url: `/classroom-generation-runs/${run.id}/scene-content`,
    headers: { cookie },
  });
  if (contentResponse.statusCode !== 202) {
    throw new Error(`Scene content request failed with HTTP ${contentResponse.statusCode}: ${contentResponse.body}`);
  }
  const contentCreated = contentResponse.json() as { generationRun?: { id?: string } };
  if (!contentCreated.generationRun?.id) throw new Error('Scene content request did not return a Generation Run ID');
  const contentRun = await waitForRun(app, cookie, contentCreated.generationRun.id, 600_000);
  if (contentRun.status !== 'completed' || contentRun.progress?.completed !== contentRun.progress?.total) {
    throw new Error(`Scene content generation did not complete: ${contentRun.error?.code ?? contentRun.status}`);
  }
  const interactiveContent = contentRun.scenes.find((scene) => scene.type === 'interactive');
  if (
    !interactiveContent
    || interactiveContent.content?.type !== 'interactive'
    || interactiveContent.content.widgetType !== 'simulation'
    || typeof interactiveContent.content.html !== 'string'
  ) {
    throw new Error('Scene content generation did not return the requested simulation interactive contract');
  }

  const actionsResponse = await app.inject({
    method: 'POST',
    url: `/classroom-generation-runs/${contentRun.id}/scene-actions`,
    headers: { cookie },
  });
  if (actionsResponse.statusCode !== 202) {
    throw new Error(`Scene actions request failed with HTTP ${actionsResponse.statusCode}: ${actionsResponse.body}`);
  }
  const actionsCreated = actionsResponse.json() as { generationRun?: { id?: string } };
  if (!actionsCreated.generationRun?.id) throw new Error('Scene actions request did not return a Generation Run ID');
  const actionsRun = await waitForRun(app, cookie, actionsCreated.generationRun.id, 300_000);
  if (actionsRun.status !== 'completed' || actionsRun.progress?.completed !== actionsRun.progress?.total) {
    throw new Error(`Scene actions generation did not complete: ${actionsRun.error?.code ?? actionsRun.status}`);
  }
  const interactiveActions = actionsRun.scenes.find((scene) => scene.type === 'interactive')?.actions ?? [];
  if (!interactiveActions.some((action) => isRecord(action) && String(action.type).startsWith('widget_'))) {
    throw new Error('Scene actions generation did not return an interactive widget action');
  }

  console.log(JSON.stringify({
    ok: true,
    providerId: run.model.providerId,
    modelId: run.model.modelId,
    attempt: run.attempt,
    courseTitle: run.outline.courseTitle,
    sceneCount: run.outline.outlines.length,
    sceneContent: contentRun.scenes.map((scene) => ({
      outlineId: scene.outlineId,
      type: scene.type,
      status: scene.status,
      attempt: scene.attempt,
      providerId: scene.model?.providerId,
      modelId: scene.model?.modelId,
    })),
    sceneActions: actionsRun.scenes.map((scene) => ({
      outlineId: scene.outlineId,
      type: scene.type,
      status: scene.status,
      attempt: scene.attempt,
      actionCount: scene.actions?.length ?? 0,
      providerId: scene.model?.providerId,
      modelId: scene.model?.modelId,
    })),
  }, null, 2));
} finally {
  await app?.close();
  if (userId) await db.delete(authUsers).where(eq(authUsers.id, userId));
  await closeDb();
}

type SmokeRun = {
  id: string;
  status: string;
  attempt?: number;
  model?: { providerId?: string; modelId?: string } | null;
  outline?: { courseTitle?: string; outlines?: unknown[] } | null;
  scenes: Array<{
    outlineId: string;
    type: string;
    status: string;
    attempt: number;
    model?: { providerId?: string; modelId?: string } | null;
    actions?: unknown[] | null;
    content?: { type?: string; widgetType?: string; html?: unknown } | null;
  }>;
  progress?: { total: number; completed: number } | null;
  error?: { code?: string } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function waitForRun(
  api: Awaited<ReturnType<typeof buildApi>>,
  cookie: string,
  runId: string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await api.inject({
      method: 'GET',
      url: `/classroom-generation-runs/${runId}`,
      headers: { cookie },
    });
    if (response.statusCode !== 200) throw new Error(`Generation Run read failed with HTTP ${response.statusCode}`);
    const run = (response.json() as { generationRun: SmokeRun }).generationRun;
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'aborted') return run;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Generation Run ${runId} did not finish before the smoke timeout`);
}
