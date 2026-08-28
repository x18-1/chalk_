import { expect, type Page } from '@playwright/test';

export async function signIn(page: Page) {
  const email = process.env.DEV_USER_EMAIL ?? 'user@qq.com';
  const password = process.env.DEV_USER_PASSWORD ?? 'user123';
  await page.goto('/login');
  await page.getByLabel('邮箱').fill(email);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '进入 Chalk' }).click();
  await page.waitForURL(/\/chat(?:\?.*)?$/, { timeout: 15_000 });
}

export async function classroomRecords(page: Page) {
  const apiUrl = process.env.E2E_API_URL ?? 'http://localhost:3001';
  return page.evaluate(async (url) => {
    const response = await fetch(`${url}/classrooms`, { credentials: 'include' });
    if (!response.ok) throw new Error(`Classroom list failed with ${response.status}`);
    return (await response.json() as { classrooms: Array<{ id: string; title: string }> }).classrooms;
  }, apiUrl);
}

export async function resetClassroomCursor(
  page: Page,
  classroomId: string,
  target: { sceneIndex?: number; actionIndex?: number; mode?: 'idle' | 'paused' } = {},
) {
  const apiUrl = process.env.E2E_API_URL ?? 'http://localhost:3001';
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
    const scenes = [...artifact.document.scenes].sort((left, right) => left.order - right.order);
    const sceneIndex = target.sceneIndex ?? 0;
    const scene = scenes[sceneIndex];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const sessionResponse = await fetch(
        `${url}/classrooms/${id}/artifacts/${record.latestArtifact.id}/learning-session`,
        { method: 'POST', credentials: 'include' },
      );
      const session = (await sessionResponse.json() as {
        learningSession: { id: string; revision: number };
      }).learningSession;
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
      if (saveResponse.ok) return;
      if (saveResponse.status !== 409 || attempt === 3) {
        throw new Error(`Cursor reset failed with ${saveResponse.status}`);
      }
    }
  }, { url: apiUrl, id: classroomId, target });
}

export async function openClassroom(
  page: Page,
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
