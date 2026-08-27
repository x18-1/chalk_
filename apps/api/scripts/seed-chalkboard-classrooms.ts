import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { normalizeClassroomPackageManifest } from '@chalk/chalkboard';

import { AuthService } from '../src/auth/auth.service';
import { loadConfig } from '../src/config';
import { closeDb, getDb } from '../src/db/client';
import { ClassroomService, type ImportClassroomInput } from '../src/modules/classrooms/services/classroom.service';
import { s3ClassroomObjectStorage } from '../src/storage/s3';

const execFileAsync = promisify(execFile);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../../..');
const equationFixturePath = resolve(
  repositoryRoot,
  'packages/chalkboard/tests/fixtures/openmaic-live-classroom.json',
);
const equationMediaPath = resolve(
  repositoryRoot,
  'apps/web/public/classroom-fixtures/4DuyVUkWv3/media/gen_img_GFBY7Qn3.jpeg',
);
const fourierArchivePath = resolve(repositoryRoot, 'packages/chalkboard/傅里叶变换入门.maic.zip');

async function equationClassroom(): Promise<ImportClassroomInput> {
  const document = JSON.parse(await readFile(equationFixturePath, 'utf8')) as Record<string, unknown>;
  const scenes = Array.isArray(document.scenes) ? document.scenes : [];
  for (const rawScene of scenes) {
    const scene = record(rawScene);
    if (!scene) continue;
    const content = record(scene.content);
    const canvas = record(content?.canvas);
    const elements = Array.isArray(canvas?.elements) ? canvas.elements : [];
    for (const rawElement of elements) {
      const element = record(rawElement);
      if (typeof element?.src !== 'string') continue;
      const marker = '/api/classroom-media/4DuyVUkWv3/';
      const markerIndex = element.src.indexOf(marker);
      if (markerIndex < 0) continue;
      element.mediaRef = element.src.slice(markerIndex + marker.length);
      delete element.src;
    }
  }
  return {
    sourceKey: 'chalkboard-v1-equation-fixture',
    title: '等式的性质与移项变号',
    document,
    media: [{
      path: 'media/gen_img_GFBY7Qn3.jpeg',
      contentType: 'image/jpeg',
      body: await readFile(equationMediaPath),
    }],
  };
}

async function fourierClassroom(): Promise<ImportClassroomInput> {
  const { stdout: manifestJson } = await execFileAsync(
    'unzip',
    ['-p', fourierArchivePath, 'manifest.json'],
    { encoding: 'utf8', maxBuffer: 16 * 1_024 * 1_024 },
  );
  const manifest = JSON.parse(manifestJson) as Record<string, unknown>;
  const document = normalizeClassroomPackageManifest(manifest, {
    stageId: '681PbzeDfm',
    mediaReference: (path) => path,
  });
  const mediaIndex = record(manifest.mediaIndex) ?? {};
  const media = await Promise.all(Object.entries(mediaIndex).map(async ([path, metadata]) => {
    const safePath = safeArchiveMediaPath(path);
    const { stdout } = await execFileAsync(
      'unzip',
      ['-p', fourierArchivePath, safePath],
      { encoding: 'buffer', maxBuffer: 32 * 1_024 * 1_024 },
    );
    const contentType = record(metadata)?.mimeType;
    return {
      path: safePath,
      contentType: typeof contentType === 'string' ? contentType : 'application/octet-stream',
      body: stdout,
    };
  }));
  return {
    sourceKey: 'chalkboard-v1-fourier-package',
    title: '傅里叶变换入门',
    document,
    media,
  };
}

function safeArchiveMediaPath(path: string) {
  const normalized = path.replaceAll('\\', '/');
  if (!normalized.startsWith('media/') || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`Unsafe fixture media path: ${path}`);
  }
  return normalized;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function main() {
  const email = process.env.DEV_USER_EMAIL?.trim().toLowerCase();
  const password = process.env.DEV_USER_PASSWORD;
  if (!email || !password) throw new Error('DEV_USER_EMAIL and DEV_USER_PASSWORD are required');

  const config = loadConfig();
  const db = getDb();
  const login = await new AuthService(db, config).login({ email, password });
  if (!login) throw new Error('Unable to resolve the development user for Chalkboard seeding');

  const service = new ClassroomService(db, s3ClassroomObjectStorage);
  const inputs = await Promise.all([equationClassroom(), fourierClassroom()]);
  for (const input of inputs) {
    const classroom = await service.importClassroom(login.user.id, input);
    console.log(`Seeded ${classroom.title} (${classroom.id}, artifact ${classroom.latestArtifact.id})`);
  }
}

try {
  await main();
} finally {
  await closeDb();
}
