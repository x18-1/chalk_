import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
loadDotenv({ path: resolve(repositoryRoot, '.env') });

const requiredEnvironment = ['ARK_API_KEY', 'DEEPSEEK_API_KEY', 'DEV_USER_EMAIL', 'DEV_USER_PASSWORD'] as const;
for (const name of requiredEnvironment) {
  if (!process.env[name]?.trim()) {
    console.error(`${name} is required for the Ark classroom media smoke test`);
    process.exit(2);
  }
}

const imageModel = 'doubao-seedream-4-5-251128';
const videoModel = 'doubao-seedance-1-5-pro-251215';
const baseUrl = `http://${process.env.API_HOST || '127.0.0.1'}:${process.env.API_PORT || '3001'}`;

const login = await fetch(`${baseUrl}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: process.env.DEV_USER_EMAIL,
    password: process.env.DEV_USER_PASSWORD,
  }),
});
if (!login.ok) throw new Error(`Smoke login failed with HTTP ${login.status}`);
const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
if (!cookie) throw new Error('Smoke login did not return a session cookie');

await saveMediaCredential('image', 'seedream', imageModel);
await saveMediaCredential('video', 'seedance', videoModel);

const resumeMediaRunId = process.argv
  .find((argument) => argument.startsWith('--resume-media-run='))
  ?.slice('--resume-media-run='.length);
let outline: SmokeRun | undefined;
let mediaRun: { id: string };

if (resumeMediaRunId) {
  mediaRun = await createRun(`/classroom-generation-runs/${resumeMediaRunId}/retry`);
} else {
  const outlineRun = await createRun('/classroom-generation-runs', {
    requirements: [
      '为初一学生生成一堂 5 分钟的勾股定理视觉导入课。',
      '必须恰好只有一个 slide Scene，不要生成 quiz、interactive 或 pbl。',
      '该 slide 必须恰好规划两个媒体：',
      '1. 一张 16:9 的直角三角形与三边平方面积关系教学插图，elementId 使用 gen_img_pythagoras_area。',
      '2. 一段 16:9 的无人物教学动画，展示两个小正方形面积组合成斜边正方形，elementId 使用 gen_vid_pythagoras_rearrange。',
      '除这一张图和一段视频外，不要请求其他媒体。',
    ].join('\n'),
    context: { sourceText: '学生已认识直角三角形，本课只做几何直观导入。' },
    media: {
      image: { providerId: 'seedream', model: imageModel, aspectRatio: '16:9' },
      video: {
        providerId: 'seedance',
        model: videoModel,
        aspectRatio: '16:9',
        durationSeconds: 5,
        resolution: '720p',
      },
    },
  });
  outline = await waitForRun(outlineRun.id, 240_000);
  assertCompleted(outline, 'outline');
  const plannedMedia = outline.outline?.outlines.flatMap((scene) => scene.mediaGenerations ?? []) ?? [];
  if (
    outline.outline?.outlines.length !== 1
    || outline.outline.outlines[0]?.type !== 'slide'
    || plannedMedia.filter((item) => item.type === 'image').length !== 1
    || plannedMedia.filter((item) => item.type === 'video').length !== 1
  ) {
    throw new Error('Outline did not produce exactly one slide with one image and one video request');
  }

  const contentRun = await createRun(`/classroom-generation-runs/${outline.id}/scene-content`);
  const content = await waitForRun(contentRun.id, 600_000);
  assertCompleted(content, 'scene content');

  const actionsRun = await createRun(`/classroom-generation-runs/${content.id}/scene-actions`);
  const actions = await waitForRun(actionsRun.id, 360_000);
  assertCompleted(actions, 'scene actions');

  mediaRun = await createRun(`/classroom-generation-runs/${actions.id}/media-tasks`, {});
}

const media = await waitForRun(mediaRun.id, 1_200_000);
assertCompleted(media, 'media tasks');
if (media.mediaTasks.length !== 2 || media.mediaTasks.some((task) => task.status !== 'completed')) {
  throw new Error('Media run did not complete exactly two planned tasks');
}
const imageTask = media.mediaTasks.find((task) => task.kind === 'image');
const videoTask = media.mediaTasks.find((task) => task.kind === 'video');
if (
  imageTask?.providerId !== 'seedream'
  || imageTask.modelId !== imageModel
  || videoTask?.providerId !== 'seedance'
  || videoTask.modelId !== videoModel
  || !imageTask.mediaRef
  || !videoTask.mediaRef
  || !imageTask.size
  || !videoTask.size
) {
  throw new Error('Media tasks did not retain the requested Ark providers, models, references, and sizes');
}

const published = await requestJson<{
  created: boolean;
  classroom: { id: string; latestArtifact: { id: string } | null };
}>(`/classroom-generation-runs/${media.id}/publish`, { method: 'POST' });
if (!published.created || !published.classroom.latestArtifact) {
  throw new Error('Media classroom was not published as a new Classroom Artifact');
}

const artifact = await requestJson<{ document: unknown }>(
  `/classrooms/${published.classroom.id}/artifacts/${published.classroom.latestArtifact.id}`,
);
const generatedMedia = findGeneratedMedia(artifact.document);
if (generatedMedia.length !== 2) throw new Error('Published Artifact did not expose exactly two generated media references');
for (const item of generatedMedia) await assertReadableMedia(item.url, item.kind);

const learningSession = await requestJson<{ learningSession: { id: string; artifactId: string } }>(
  `/classrooms/${published.classroom.id}/artifacts/${published.classroom.latestArtifact.id}/learning-session`,
  { method: 'POST' },
);
if (learningSession.learningSession.artifactId !== published.classroom.latestArtifact.id) {
  throw new Error('Learning Session did not bind the published Artifact');
}

console.log(JSON.stringify({
  ok: true,
  resumedMediaRun: Boolean(resumeMediaRunId),
  outlineProvider: outline?.model?.providerId,
  outlineModel: outline?.model?.modelId,
  sceneCount: outline?.outline?.outlines.length,
  mediaTasks: media.mediaTasks.map((task) => ({
    kind: task.kind,
    providerId: task.providerId,
    modelId: task.modelId,
    size: task.size,
    contentType: task.contentType,
  })),
  published: true,
  artifactReadable: true,
  learningSessionCreated: Boolean(learningSession.learningSession.id),
}, null, 2));

async function saveMediaCredential(capability: 'image' | 'video', providerId: string, modelId: string) {
  await requestJson(`/media/providers/${capability}/${providerId}/credential`, {
    method: 'PUT',
    body: JSON.stringify({
      apiKey: process.env.ARK_API_KEY,
      settings: { modelId },
    }),
  });
}

async function createRun(path: string, payload?: unknown) {
  const response = await requestJson<{ generationRun: { id: string } }>(path, {
    method: 'POST',
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  if (!response.generationRun?.id) throw new Error('Generation endpoint did not return a run ID');
  return response.generationRun;
}

async function waitForRun(runId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await requestJson<{ generationRun: SmokeRun }>(`/classroom-generation-runs/${runId}`);
    const run = response.generationRun;
    if (['completed', 'failed', 'aborted'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Generation Run ${runId} did not finish before the smoke timeout`);
}

function assertCompleted(run: SmokeRun, stage: string) {
  if (run.status !== 'completed') {
    throw new Error(`${stage} did not complete: ${run.error?.code ?? run.status}`);
  }
}

async function requestJson<T = unknown>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      cookie,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = await response.json().catch(() => ({})) as { code?: string } & T;
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${path}: ${body.code ?? 'UNKNOWN_ERROR'}`);
  return body;
}

function findGeneratedMedia(document: unknown) {
  const found = new Map<string, { kind: 'image' | 'video'; url: string }>();
  visit(document);
  return [...found.values()];

  function visit(value: unknown) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    const mediaRef = typeof value.mediaRef === 'string' ? value.mediaRef : undefined;
    const url = typeof value.src === 'string' ? value.src : undefined;
    const type = typeof value.type === 'string' ? value.type : undefined;
    if (mediaRef?.startsWith('media/generated/') && url?.startsWith('http')) {
      const kind = type === 'video' || mediaRef.endsWith('.mp4') || mediaRef.endsWith('.webm')
        ? 'video'
        : 'image';
      found.set(mediaRef, { kind, url });
    }
    Object.values(value).forEach(visit);
  }
}

async function assertReadableMedia(url: string, kind: 'image' | 'video') {
  const response = await fetch(url, { headers: { range: 'bytes=0-0' } });
  if (!response.ok || !response.headers.get('content-type')?.startsWith(`${kind}/`)) {
    throw new Error(`Published ${kind} media was not readable from object storage`);
  }
  await response.body?.cancel();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type SmokeRun = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'aborted';
  model?: { providerId?: string; modelId?: string } | null;
  outline?: {
    outlines: Array<{
      type: string;
      mediaGenerations?: Array<{ type: 'image' | 'video'; elementId: string }>;
    }>;
  } | null;
  mediaTasks: Array<{
    kind: 'audio' | 'image' | 'video';
    status: string;
    providerId: string | null;
    modelId: string | null;
    mediaRef: string | null;
    contentType: string | null;
    size: number | null;
  }>;
  error?: { code?: string } | null;
};
