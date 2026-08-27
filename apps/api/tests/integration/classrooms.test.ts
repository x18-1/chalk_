import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { hash } from 'bcryptjs';
import { inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';

import { buildApi } from '../../src/app';
import { loadConfig } from '../../src/config';
import { closeDb, getDb } from '../../src/db/client';
import { authUsers } from '../../src/db/schema';
import { ClassroomService } from '../../src/modules/classrooms/services/classroom.service';

describe('Classroom HTTP boundary', () => {
  const suffix = randomUUID();
  const password = `password-${suffix}`;
  const users = [
    { email: `classroom-user-${suffix}@chalk.local`, role: 'user' as const, name: '课堂学生' },
    { email: `classroom-admin-${suffix}@chalk.local`, role: 'admin' as const, name: '课堂管理员' },
  ];
  const cookies = new Map<'user' | 'admin', string>();
  const userIds: string[] = [];
  const userIdByRole = new Map<'user' | 'admin', string>();
  const objects = new Map<string, Buffer>();
  let failingObjectSuffix: string | null = null;
  const createdClassrooms = new Map<'user' | 'admin', {
    id: string;
    latestArtifact: { id: string };
  }>();
  let app: Awaited<ReturnType<typeof buildApi>>;

  const objectStorage = {
    publicUrl: () => undefined,
    createUploadUrl: async () => 'https://uploads.example.test/signed',
    inspectObject: async () => ({ size: 0, contentType: 'application/octet-stream' }),
    putObject: async (input: { fileKey: string; body: Buffer; contentType: string }) => {
      if (input.contentType === 'application/json') {
        throw new Error('Classroom JSON must not be written to object storage');
      }
      if (failingObjectSuffix && input.fileKey.endsWith(failingObjectSuffix)) {
        throw new Error('Simulated object storage failure');
      }
      objects.set(input.fileKey, input.body);
    },
    createDownloadUrl: async (fileKey: string) => `https://media.example.test/${fileKey}`,
    deleteObject: async (fileKey: string) => {
      objects.delete(fileKey);
    },
  };

  function responseCookie(value: string | string[] | undefined) {
    const first = Array.isArray(value) ? value[0] : value;
    return first?.split(';', 1)[0] ?? '';
  }

  function classroomDocument(stageId: string, name: string) {
    return {
      stage: { id: stageId, name, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 },
      scenes: [{
        id: `${stageId}-scene-1`,
        stageId,
        type: 'slide',
        title: '认识概念',
        order: 0,
        content: { type: 'slide', canvas: { elements: [] } },
        actions: [],
      }],
    };
  }

  function quizClassroomDocument(stageId: string, name: string) {
    return {
      stage: { id: stageId, name, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 },
      scenes: [{
        id: `${stageId}-quiz-1`,
        stageId,
        type: 'quiz',
        title: '知识检查',
        order: 0,
        content: {
          type: 'quiz',
          questions: [
            {
              id: 'equation-single',
              type: 'single',
              question: 'x + 3 = 5 中，x 等于多少？',
              options: [
                { value: 'a', label: '1' },
                { value: 'b', label: '2' },
              ],
              answer: ['b'],
              analysis: '等式两边同时减去 3。',
              points: 2,
            },
            {
              id: 'equation-multiple',
              type: 'multiple',
              question: '哪些变形保持等式成立？',
              options: [
                { value: 'a', label: '两边同时加 2' },
                { value: 'b', label: '只把左边乘 2' },
                { value: 'c', label: '两边同时除以非零数' },
              ],
              answer: ['a', 'c'],
              analysis: '等式两边必须进行相同运算。',
              points: 1,
            },
          ],
        },
        actions: [],
      }],
    };
  }

  async function classroomArchive(filename: string, options: {
    classroomId?: string;
    extraFile?: boolean;
    exportedAt?: string;
    invalidDocument?: boolean;
    mediaPath?: string;
    omitTimestamps?: boolean;
    pathTraversal?: boolean;
    secondMedia?: boolean;
    symlinkMedia?: boolean;
    undeclaredMediaReference?: boolean;
    revisionLabel?: string;
  } = {}) {
    const mediaPath = options.mediaPath ?? 'media/butterfly.png';
    const archive = new ZipFile();
    archive.addBuffer(Buffer.from(JSON.stringify({
      format: 'chalk-classroom',
      formatVersion: 1,
      ...(options.classroomId ? { classroomId: options.classroomId } : {}),
      exportedAt: options.exportedAt ?? '2026-08-26T00:00:00.000Z',
      stage: {
        name: '图形的轴对称',
        ...(!options.omitTimestamps ? {
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        } : {}),
      },
      scenes: options.invalidDocument ? [] : [{
        type: 'slide',
        title: '观察对称图形',
        order: 0,
        ...(!options.omitTimestamps ? {
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
        } : {}),
        content: {
          type: 'slide',
          canvas: { elements: [{
            id: 'butterfly',
            type: 'image',
            ...(options.undeclaredMediaReference
              ? { mediaRef: 'media/missing-image.png' }
              : { src: 'butterfly' }),
          }, ...(options.revisionLabel ? [{ id: 'revision', type: 'text', content: options.revisionLabel }] : [])] },
        },
        actions: [],
      }],
      mediaIndex: {
        [mediaPath]: { mimeType: 'image/png' },
        ...(options.secondMedia ? { 'media/axis.png': { mimeType: 'image/png' } } : {}),
      },
    })), 'manifest.json');
    archive.addBuffer(
      Buffer.from('known-butterfly-bytes'),
      mediaPath,
      options.symlinkMedia ? { mode: 0o120777 } : undefined,
    );
    if (options.secondMedia) archive.addBuffer(Buffer.from('known-axis-bytes'), 'media/axis.png');
    if (options.extraFile) archive.addBuffer(Buffer.from('not declared'), 'notes.txt');
    if (options.pathTraversal) archive.addBuffer(Buffer.from('unsafe'), 'aa/payload.txt');
    archive.end();
    const chunks: Buffer[] = [];
    for await (const chunk of archive.outputStream) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    if (options.pathTraversal) {
      const safePath = Buffer.from('aa/payload.txt');
      const unsafePath = Buffer.from('../payload.txt');
      let offset = 0;
      while ((offset = body.indexOf(safePath, offset)) >= 0) {
        unsafePath.copy(body, offset);
        offset += unsafePath.byteLength;
      }
    }
    return multipartFile(filename, body);
  }

  function multipartFile(filename: string, body: Buffer, fieldName = 'file') {
    const boundary = `chalk-${randomUUID()}`;
    return {
      body: Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: application/zip\r\n\r\n`),
        body,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }

  beforeAll(async () => {
    const insertedUsers = await getDb()
      .insert(authUsers)
      .values(await Promise.all(users.map(async (user) => ({
        ...user,
        passwordHash: await hash(password, 4),
      }))))
      .returning({ id: authUsers.id, role: authUsers.role });
    userIds.push(...insertedUsers.map((user) => user.id));
    for (const user of insertedUsers) userIdByRole.set(user.role as 'user' | 'admin', user.id);

    app = await buildApi({
      config: loadConfig({
        NODE_ENV: 'test',
        SESSION_COOKIE_NAME: `classrooms_${suffix}`,
        SESSION_COOKIE_SECURE: 'false',
      }),
      objectStorage,
      classroomObjectStorage: objectStorage,
    });

    for (const user of users) {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, password },
      });
      expect(login.statusCode).toBe(200);
      cookies.set(user.role, responseCookie(login.headers['set-cookie']));
    }
  });

  afterAll(async () => {
    await app?.close();
    if (userIds.length > 0) await getDb().delete(authUsers).where(inArray(authUsers.id, userIds));
    await closeDb();
  });

  it('lets user and admin accounts create JSON-backed classrooms while object storage rejects JSON blobs', async () => {
    for (const role of ['user', 'admin'] as const) {
      const response = await app.inject({
        method: 'POST',
        url: '/classrooms',
        headers: { cookie: cookies.get(role) },
        payload: {
          title: role === 'user' ? '分数入门' : '一次函数',
          document: classroomDocument(`${role}-stage`, role === 'user' ? '分数入门' : '一次函数'),
        },
      });
      expect(response.statusCode).toBe(201);
      createdClassrooms.set(role, response.json().classroom);
    }

    const [userList, adminList] = await Promise.all((['user', 'admin'] as const).map((role) => app.inject({
      method: 'GET',
      url: '/classrooms',
      headers: { cookie: cookies.get(role) },
    })));

    expect(userList.statusCode).toBe(200);
    expect(userList.json().classrooms).toEqual([
      expect.objectContaining({ title: '分数入门', latestArtifact: expect.objectContaining({ version: 1 }) }),
    ]);
    expect(adminList.statusCode).toBe(200);
    expect(adminList.json().classrooms).toEqual([
      expect.objectContaining({ title: '一次函数', latestArtifact: expect.objectContaining({ version: 1 }) }),
    ]);
    expect(objects.size).toBe(0);
  });

  it('creates and resumes one owned learning session for the exact classroom artifact', async () => {
    const createdClassroom = await app.inject({
      method: 'POST',
      url: '/classrooms',
      headers: { cookie: cookies.get('user') },
      payload: {
        title: '学习会话门禁',
        document: classroomDocument('learning-session-stage', '学习会话门禁'),
      },
    });
    expect(createdClassroom.statusCode).toBe(201);
    const classroom = createdClassroom.json().classroom as {
      id: string;
      latestArtifact: { id: string };
    };
    const url = `/classrooms/${classroom.id}/artifacts/${classroom.latestArtifact.id}/learning-session`;

    const [anonymous, otherOwner] = await Promise.all([
      app.inject({ method: 'POST', url }),
      app.inject({ method: 'POST', url, headers: { cookie: cookies.get('admin') } }),
    ]);
    expect(anonymous.statusCode).toBe(401);
    expect(otherOwner.statusCode).toBe(404);

    const created = await app.inject({
      method: 'POST',
      url,
      headers: { cookie: cookies.get('user') },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      created: true,
      learningSession: {
        classroomId: classroom.id,
        artifactId: classroom.latestArtifact.id,
        revision: 1,
        cursor: {
          version: 1,
          stageId: 'learning-session-stage',
          sceneId: 'learning-session-stage-scene-1',
          sceneIndex: 0,
          actionIndex: 0,
          mode: 'idle',
          completed: false,
        },
      },
    });

    const resumed = await app.inject({
      method: 'POST',
      url,
      headers: { cookie: cookies.get('user') },
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toMatchObject({
      created: false,
      learningSession: {
        id: created.json().learningSession.id,
        revision: 1,
        cursor: created.json().learningSession.cursor,
      },
    });

    const newArtifact = await app.inject({
      method: 'POST',
      url: `/classrooms/${classroom.id}/artifacts`,
      headers: { cookie: cookies.get('user') },
      payload: { document: classroomDocument('learning-session-stage-v2', '学习会话门禁 V2') },
    });
    expect(newArtifact.statusCode).toBe(201);
    const newArtifactId = newArtifact.json().latestArtifact.id as string;
    const newArtifactSession = await app.inject({
      method: 'POST',
      url: `/classrooms/${classroom.id}/artifacts/${newArtifactId}/learning-session`,
      headers: { cookie: cookies.get('user') },
    });
    expect(newArtifactSession.statusCode).toBe(201);
    expect(newArtifactSession.json().learningSession).toMatchObject({
      artifactId: newArtifactId,
      cursor: { stageId: 'learning-session-stage-v2' },
    });
    expect(newArtifactSession.json().learningSession.id).not.toBe(created.json().learningSession.id);
  });

  it('saves a semantically valid cursor with optimistic concurrency and owner isolation', async () => {
    const createdClassroom = await app.inject({
      method: 'POST',
      url: '/classrooms',
      headers: { cookie: cookies.get('user') },
      payload: {
        title: '游标并发门禁',
        document: classroomDocument('cursor-stage', '游标并发门禁'),
      },
    });
    const classroom = createdClassroom.json().classroom as {
      id: string;
      latestArtifact: { id: string };
    };
    const createdSession = await app.inject({
      method: 'POST',
      url: `/classrooms/${classroom.id}/artifacts/${classroom.latestArtifact.id}/learning-session`,
      headers: { cookie: cookies.get('user') },
    });
    const sessionId = createdSession.json().learningSession.id as string;
    const cursor = {
      version: 1,
      stageId: 'cursor-stage',
      sceneId: 'cursor-stage-scene-1',
      sceneIndex: 0,
      actionIndex: 0,
      mode: 'paused',
      completed: false,
    };

    const saved = await app.inject({
      method: 'PUT',
      url: `/learning-sessions/${sessionId}/cursor`,
      headers: { cookie: cookies.get('user') },
      payload: { expectedRevision: 1, cursor },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().learningSession).toMatchObject({ id: sessionId, revision: 2, cursor });

    const stale = await app.inject({
      method: 'PUT',
      url: `/learning-sessions/${sessionId}/cursor`,
      headers: { cookie: cookies.get('user') },
      payload: { expectedRevision: 1, cursor: { ...cursor, mode: 'playing' } },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({
      error: 'Playback cursor has a newer saved revision',
      code: 'PLAYBACK_CURSOR_CONFLICT',
    });

    const invalidArtifactCursor = await app.inject({
      method: 'PUT',
      url: `/learning-sessions/${sessionId}/cursor`,
      headers: { cookie: cookies.get('user') },
      payload: { expectedRevision: 2, cursor: { ...cursor, stageId: 'another-artifact-stage' } },
    });
    expect(invalidArtifactCursor.statusCode).toBe(422);
    expect(invalidArtifactCursor.json()).toEqual({
      error: 'Playback cursor does not belong to this classroom artifact',
      code: 'PLAYBACK_CURSOR_INVALID',
    });

    const [ownerRead, otherRead, otherWrite] = await Promise.all([
      app.inject({
        method: 'GET',
        url: `/learning-sessions/${sessionId}`,
        headers: { cookie: cookies.get('user') },
      }),
      app.inject({
        method: 'GET',
        url: `/learning-sessions/${sessionId}`,
        headers: { cookie: cookies.get('admin') },
      }),
      app.inject({
        method: 'PUT',
        url: `/learning-sessions/${sessionId}/cursor`,
        headers: { cookie: cookies.get('admin') },
        payload: { expectedRevision: 2, cursor },
      }),
    ]);
    expect(ownerRead.statusCode).toBe(200);
    expect(ownerRead.json().learningSession).toMatchObject({ revision: 2, cursor });
    expect(otherRead.statusCode).toBe(404);
    expect(otherWrite.statusCode).toBe(404);
  });

  it('restores the latest cursor from PostgreSQL in a new API instance', async () => {
    const createdClassroom = await app.inject({
      method: 'POST',
      url: '/classrooms',
      headers: { cookie: cookies.get('user') },
      payload: {
        title: '进程恢复门禁',
        document: classroomDocument('restart-stage', '进程恢复门禁'),
      },
    });
    const classroom = createdClassroom.json().classroom as {
      id: string;
      latestArtifact: { id: string };
    };
    const createdSession = await app.inject({
      method: 'POST',
      url: `/classrooms/${classroom.id}/artifacts/${classroom.latestArtifact.id}/learning-session`,
      headers: { cookie: cookies.get('user') },
    });
    const sessionId = createdSession.json().learningSession.id as string;
    const cursor = {
      ...createdSession.json().learningSession.cursor,
      mode: 'paused',
    };
    const saved = await app.inject({
      method: 'PUT',
      url: `/learning-sessions/${sessionId}/cursor`,
      headers: { cookie: cookies.get('user') },
      payload: { expectedRevision: 1, cursor },
    });
    expect(saved.statusCode).toBe(200);

    const restartedApp = await buildApi({
      config: loadConfig({
        NODE_ENV: 'test',
        SESSION_COOKIE_NAME: `classrooms_${suffix}`,
        SESSION_COOKIE_SECURE: 'false',
      }),
      objectStorage,
      classroomObjectStorage: objectStorage,
    });
    try {
      const restored = await restartedApp.inject({
        method: 'GET',
        url: `/learning-sessions/${sessionId}`,
        headers: { cookie: cookies.get('user') },
      });
      expect(restored.statusCode).toBe(200);
      expect(restored.json().learningSession).toMatchObject({
        id: sessionId,
        artifactId: classroom.latestArtifact.id,
        revision: 2,
        cursor,
      });
    } finally {
      await restartedApp.close();
    }
  });

  it('submits and restores a server-scored quiz attempt for the owned learning session', async () => {
    const createdClassroom = await app.inject({
      method: 'POST',
      url: '/classrooms',
      headers: { cookie: cookies.get('user') },
      payload: {
        title: '答题持久化门禁',
        document: quizClassroomDocument('quiz-attempt-stage', '答题持久化门禁'),
      },
    });
    const classroom = createdClassroom.json().classroom as {
      id: string;
      latestArtifact: { id: string };
    };
    const createdSession = await app.inject({
      method: 'POST',
      url: `/classrooms/${classroom.id}/artifacts/${classroom.latestArtifact.id}/learning-session`,
      headers: { cookie: cookies.get('user') },
    });
    const sessionId = createdSession.json().learningSession.id as string;

    const submitted = await app.inject({
      method: 'PUT',
      url: `/learning-sessions/${sessionId}/quiz-attempts/quiz-attempt-stage-quiz-1`,
      headers: { cookie: cookies.get('user') },
      payload: {
        expectedRevision: 0,
        answers: {
          'equation-single': ['b'],
          'equation-multiple': ['a'],
        },
      },
    });
    expect(submitted.statusCode).toBe(201);
    expect(submitted.json().quizAttempt).toMatchObject({
      learningSessionId: sessionId,
      artifactId: classroom.latestArtifact.id,
      sceneId: 'quiz-attempt-stage-quiz-1',
      answers: {
        'equation-single': ['b'],
        'equation-multiple': ['a'],
      },
      results: [
        { questionId: 'equation-single', correct: true, awardedPoints: 2, maxPoints: 2 },
        { questionId: 'equation-multiple', correct: false, awardedPoints: 0, maxPoints: 1 },
      ],
      score: 2,
      maxScore: 3,
      revision: 1,
    });

    const restored = await app.inject({
      method: 'GET',
      url: `/learning-sessions/${sessionId}/quiz-attempts`,
      headers: { cookie: cookies.get('user') },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().quizAttempts).toEqual([
      expect.objectContaining({
        id: submitted.json().quizAttempt.id,
        sceneId: 'quiz-attempt-stage-quiz-1',
        score: 2,
        maxScore: 3,
        revision: 1,
      }),
    ]);
  });

  it('re-submits quiz answers with owner isolation, validation, conflicts, and API restart recovery', async () => {
    const createdClassroom = await app.inject({
      method: 'POST',
      url: '/classrooms',
      headers: { cookie: cookies.get('user') },
      payload: {
        title: '答题并发门禁',
        document: quizClassroomDocument('quiz-conflict-stage', '答题并发门禁'),
      },
    });
    const classroom = createdClassroom.json().classroom as {
      id: string;
      latestArtifact: { id: string };
    };
    const createdSession = await app.inject({
      method: 'POST',
      url: `/classrooms/${classroom.id}/artifacts/${classroom.latestArtifact.id}/learning-session`,
      headers: { cookie: cookies.get('user') },
    });
    const sessionId = createdSession.json().learningSession.id as string;
    const url = `/learning-sessions/${sessionId}/quiz-attempts/quiz-conflict-stage-quiz-1`;
    const firstAnswers = {
      'equation-single': ['a'],
      'equation-multiple': ['a'],
    };
    const first = await app.inject({
      method: 'PUT',
      url,
      headers: { cookie: cookies.get('user') },
      payload: { expectedRevision: 0, answers: firstAnswers },
    });
    expect(first.statusCode).toBe(201);

    const correctedAnswers = {
      'equation-single': ['b'],
      'equation-multiple': ['c', 'a'],
    };
    const corrected = await app.inject({
      method: 'PUT',
      url,
      headers: { cookie: cookies.get('user') },
      payload: { expectedRevision: 1, answers: correctedAnswers },
    });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.json().quizAttempt).toMatchObject({
      id: first.json().quizAttempt.id,
      answers: correctedAnswers,
      score: 3,
      maxScore: 3,
      revision: 2,
    });

    const [stale, invalid, anonymousRead, otherRead, otherWrite] = await Promise.all([
      app.inject({
        method: 'PUT',
        url,
        headers: { cookie: cookies.get('user') },
        payload: { expectedRevision: 1, answers: firstAnswers },
      }),
      app.inject({
        method: 'PUT',
        url,
        headers: { cookie: cookies.get('user') },
        payload: {
          expectedRevision: 2,
          answers: { ...correctedAnswers, 'equation-single': ['not-an-authored-option'] },
        },
      }),
      app.inject({ method: 'GET', url: `/learning-sessions/${sessionId}/quiz-attempts` }),
      app.inject({
        method: 'GET',
        url: `/learning-sessions/${sessionId}/quiz-attempts`,
        headers: { cookie: cookies.get('admin') },
      }),
      app.inject({
        method: 'PUT',
        url,
        headers: { cookie: cookies.get('admin') },
        payload: { expectedRevision: 2, answers: correctedAnswers },
      }),
    ]);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({
      error: 'Quiz attempt has a newer saved revision',
      code: 'QUIZ_ATTEMPT_CONFLICT',
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json()).toEqual({
      error: 'Quiz answers do not match this quiz scene',
      code: 'QUIZ_ANSWERS_INVALID',
    });
    expect(anonymousRead.statusCode).toBe(401);
    expect(otherRead.statusCode).toBe(404);
    expect(otherWrite.statusCode).toBe(404);

    const restartedApp = await buildApi({
      config: loadConfig({
        NODE_ENV: 'test',
        SESSION_COOKIE_NAME: `classrooms_${suffix}`,
        SESSION_COOKIE_SECURE: 'false',
      }),
      objectStorage,
      classroomObjectStorage: objectStorage,
    });
    try {
      const restored = await restartedApp.inject({
        method: 'GET',
        url: `/learning-sessions/${sessionId}/quiz-attempts`,
        headers: { cookie: cookies.get('user') },
      });
      expect(restored.statusCode).toBe(200);
      expect(restored.json().quizAttempts).toEqual([
        expect.objectContaining({
          id: first.json().quizAttempt.id,
          answers: correctedAnswers,
          score: 3,
          maxScore: 3,
          revision: 2,
        }),
      ]);
    } finally {
      await restartedApp.close();
    }
  });

  it('imports a Chalk Classroom Archive into an owned PostgreSQL artifact and MinIO media', async () => {
    const archive = await classroomArchive('axis-symmetry.chalk.zip');
    const anonymous = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { 'content-type': archive.contentType },
      payload: archive.body,
    });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    const imported = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('user'), 'content-type': archive.contentType },
      payload: archive.body,
    });

    expect(imported.statusCode).toBe(201);
    expect(imported.json().classroom).toMatchObject({
      title: '图形的轴对称',
      latestArtifact: { version: 1 },
    });
    const classroom = imported.json().classroom as { id: string; latestArtifact: { id: string } };
    const artifact = await app.inject({
      method: 'GET',
      url: `/classrooms/${classroom.id}/artifacts/${classroom.latestArtifact.id}`,
      headers: { cookie: cookies.get('user') },
    });
    expect(artifact.statusCode).toBe(200);
    expect(artifact.json().document).toMatchObject({
      stage: { name: '图形的轴对称' },
      scenes: [{
        title: '观察对称图形',
        content: { canvas: { elements: [{ mediaRef: 'media/butterfly.png' }] } },
      }],
    });
    expect([...objects.entries()]).toEqual(expect.arrayContaining([
      [expect.stringMatching(/\/media\/butterfly\.png$/), Buffer.from('known-butterfly-bytes')],
    ]));
  });

  it('rejects a generic ZIP filename even when its contents resemble a classroom', async () => {
    const archive = await classroomArchive('classroom.zip');
    const response = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('user'), 'content-type': archive.contentType },
      payload: archive.body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'Only .chalk.zip and .maic.zip classroom archives are supported',
      code: 'CLASSROOM_ARCHIVE_TYPE_UNSUPPORTED',
    });
  });

  it('rejects a classroom archive containing a path traversal entry', async () => {
    const archive = await classroomArchive('path-traversal.chalk.zip', { pathTraversal: true });
    const response = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('user'), 'content-type': archive.contentType },
      payload: archive.body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'Classroom archive could not be read',
      code: 'CLASSROOM_ARCHIVE_INVALID',
    });
  });

  it('rejects a classroom archive containing a symbolic link', async () => {
    const archive = await classroomArchive('unsafe.chalk.zip', { symlinkMedia: true });
    const response = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('user'), 'content-type': archive.contentType },
      payload: archive.body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'Classroom archive contains an unsupported file',
      code: 'CLASSROOM_ARCHIVE_INVALID',
    });
  });

  it('rejects files that are not declared by the classroom manifest', async () => {
    const archive = await classroomArchive('undeclared.chalk.zip', { extraFile: true });
    const response = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('user'), 'content-type': archive.contentType },
      payload: archive.body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'Classroom archive contains files not declared by manifest.json',
      code: 'CLASSROOM_ARCHIVE_INVALID',
    });
  });

  it('rejects classroom media references that are not declared by the manifest', async () => {
    const archive = await classroomArchive('missing-media.chalk.zip', { undeclaredMediaReference: true });
    const response = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('user'), 'content-type': archive.contentType },
      payload: archive.body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'Classroom document references media not declared by manifest.json',
      code: 'CLASSROOM_MEDIA_UNDECLARED',
    });
  });

  it('rejects a manifest that cannot produce a valid Classroom Artifact', async () => {
    const archive = await classroomArchive('invalid-classroom.chalk.zip', { invalidDocument: true });
    const response = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('user'), 'content-type': archive.contentType },
      payload: archive.body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'Classroom manifest does not contain a valid classroom',
      code: 'CLASSROOM_DOCUMENT_INVALID',
    });
  });

  it('rejects a classroom archive larger than the upload limit', async () => {
    const archive = multipartFile('too-large.chalk.zip', Buffer.alloc(32 * 1_024 * 1_024 + 1));
    const response = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('user'), 'content-type': archive.contentType },
      payload: archive.body,
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({
      error: 'Classroom archive exceeds the 32 MiB upload limit',
      code: 'CLASSROOM_ARCHIVE_TOO_LARGE',
    });
  });

  it('rejects manifest media outside the media directory', async () => {
    const archive = await classroomArchive('unsafe-media.chalk.zip', {
      mediaPath: 'assets/butterfly.png',
    });
    const response = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('user'), 'content-type': archive.contentType },
      payload: archive.body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'Classroom media must be stored under media/',
      code: 'CLASSROOM_MEDIA_PATH_INVALID',
    });
  });

  it('keeps repeated semantic imports idempotent when archive export metadata changes', async () => {
    const firstArchive = await classroomArchive('repeat.chalk.zip', {
      exportedAt: '2026-08-26T00:00:00.000Z',
    });
    const secondArchive = await classroomArchive('repeat.chalk.zip', {
      exportedAt: '2026-08-27T00:00:00.000Z',
    });
    const first = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('admin'), 'content-type': firstArchive.contentType },
      payload: firstArchive.body,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('admin'), 'content-type': secondArchive.contentType },
      payload: secondArchive.body,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().classroom.id).toBe(first.json().classroom.id);
  });

  it('imports a revised archive as a new immutable Artifact under the same Classroom', async () => {
    const classroomId = randomUUID();
    const firstArchive = await classroomArchive('revision-v1.chalk.zip', {
      classroomId,
      revisionLabel: '第一版',
    });
    const secondArchive = await classroomArchive('renamed-revision-v2.chalk.zip', {
      classroomId,
      revisionLabel: '第二版',
    });
    const first = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('admin'), 'content-type': firstArchive.contentType },
      payload: firstArchive.body,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('admin'), 'content-type': secondArchive.contentType },
      payload: secondArchive.body,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().classroom).toMatchObject({
      id: first.json().classroom.id,
      latestArtifact: { version: 2 },
    });
    expect(second.json().classroom.latestArtifact.id).not.toBe(first.json().classroom.latestArtifact.id);

    const [firstArtifact, secondArtifact] = await Promise.all([
      app.inject({
        method: 'GET',
        url: `/classrooms/${first.json().classroom.id}/artifacts/${first.json().classroom.latestArtifact.id}`,
        headers: { cookie: cookies.get('admin') },
      }),
      app.inject({
        method: 'GET',
        url: `/classrooms/${second.json().classroom.id}/artifacts/${second.json().classroom.latestArtifact.id}`,
        headers: { cookie: cookies.get('admin') },
      }),
    ]);
    expect(firstArtifact.json().document.scenes[0].content.canvas.elements[1].content).toBe('第一版');
    expect(secondArtifact.json().document.scenes[0].content.canvas.elements[1].content).toBe('第二版');
  });

  it('rolls back uploaded media when object storage fails during import', async () => {
    const beforeKeys = [...objects.keys()].sort();
    const beforeList = await app.inject({
      method: 'GET',
      url: '/classrooms',
      headers: { cookie: cookies.get('user') },
    });
    const beforeCount = beforeList.json().classrooms.length as number;
    const archive = await classroomArchive('storage-failure.chalk.zip', { secondMedia: true });
    failingObjectSuffix = '/media/axis.png';
    const response = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('user'), 'content-type': archive.contentType },
      payload: archive.body,
    });
    failingObjectSuffix = null;

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: 'Classroom media storage is temporarily unavailable',
      code: 'CLASSROOM_MEDIA_STORAGE_UNAVAILABLE',
    });
    expect([...objects.keys()].sort()).toEqual(beforeKeys);
    const list = await app.inject({
      method: 'GET',
      url: '/classrooms',
      headers: { cookie: cookies.get('user') },
    });
    expect(list.json().classrooms).toHaveLength(beforeCount);
  });

  it('imports the real OpenMAIC Archive and keeps it isolated to its owner', async () => {
    const archiveBody = await readFile(new URL(
      '../../../../packages/chalkboard/傅里叶变换入门.maic.zip',
      import.meta.url,
    ));
    const archive = multipartFile('fourier.maic.zip', archiveBody);
    const imported = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('admin'), 'content-type': archive.contentType },
      payload: archive.body,
    });

    expect(imported.statusCode).toBe(201);
    const classroom = imported.json().classroom as { id: string; latestArtifact: { id: string } };
    const url = `/classrooms/${classroom.id}/artifacts/${classroom.latestArtifact.id}`;
    const [owner, foreign] = await Promise.all([
      app.inject({ method: 'GET', url, headers: { cookie: cookies.get('admin') } }),
      app.inject({ method: 'GET', url, headers: { cookie: cookies.get('user') } }),
    ]);
    expect(owner.statusCode).toBe(200);
    expect(owner.json().document).toMatchObject({
      stage: { name: '傅里叶变换入门' },
    });
    expect(owner.json().document.scenes).toHaveLength(12);
    expect(foreign.statusCode).toBe(404);
  });

  it('keeps imports without authored timestamps deterministic', async () => {
    const firstArchive = await classroomArchive('no-timestamps.chalk.zip', {
      exportedAt: '2026-08-26T00:00:00.000Z',
      omitTimestamps: true,
    });
    const secondArchive = await classroomArchive('no-timestamps.chalk.zip', {
      exportedAt: '2026-08-27T00:00:00.000Z',
      omitTimestamps: true,
    });
    const first = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('user'), 'content-type': firstArchive.contentType },
      payload: firstArchive.body,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('user'), 'content-type': secondArchive.contentType },
      payload: secondArchive.body,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().classroom.id).toBe(first.json().classroom.id);
  });

  it('rejects an archive uploaded under an unexpected multipart field', async () => {
    const archive = multipartFile('wrong-field.chalk.zip', Buffer.from('not read'), 'archive');
    const response = await app.inject({
      method: 'POST',
      url: '/classrooms/import',
      headers: { cookie: cookies.get('user'), 'content-type': archive.contentType },
      payload: archive.body,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'Classroom archive must use the file field',
      code: 'CLASSROOM_ARCHIVE_FIELD_INVALID',
    });
  });

  it('lets only the owner read an immutable classroom artifact', async () => {
    const owned = createdClassrooms.get('user')!;
    const url = `/classrooms/${owned.id}/artifacts/${owned.latestArtifact.id}`;

    const [ownerResponse, foreignResponse, anonymousResponse] = await Promise.all([
      app.inject({ method: 'GET', url, headers: { cookie: cookies.get('user') } }),
      app.inject({ method: 'GET', url, headers: { cookie: cookies.get('admin') } }),
      app.inject({ method: 'GET', url }),
    ]);

    expect(ownerResponse.statusCode).toBe(200);
    expect(ownerResponse.json()).toMatchObject({
      id: owned.id,
      latestArtifact: { id: owned.latestArtifact.id, version: 1 },
      document: {
        stage: { id: 'user-stage', name: '分数入门' },
        scenes: [{ id: 'user-stage-scene-1' }],
      },
    });
    expect(foreignResponse.statusCode).toBe(404);
    expect(foreignResponse.json()).toEqual({ error: 'Resource not found', code: 'NOT_FOUND' });
    expect(anonymousResponse.statusCode).toBe(401);
    expect(anonymousResponse.json()).toEqual({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  });

  it('creates a new artifact version without changing the previous artifact', async () => {
    const owned = createdClassrooms.get('user')!;
    const previousArtifactId = owned.latestArtifact.id;
    const revisedDocument = classroomDocument('user-stage', '分数的加减法');

    const created = await app.inject({
      method: 'POST',
      url: `/classrooms/${owned.id}/artifacts`,
      headers: { cookie: cookies.get('user') },
      payload: { document: revisedDocument },
    });

    expect(created.statusCode).toBe(201);
    const current = created.json() as {
      latestArtifact: { id: string; version: number };
    };
    expect(current.latestArtifact.version).toBe(2);
    expect(current.latestArtifact.id).not.toBe(previousArtifactId);

    const [previous, latest, list] = await Promise.all([
      app.inject({
        method: 'GET',
        url: `/classrooms/${owned.id}/artifacts/${previousArtifactId}`,
        headers: { cookie: cookies.get('user') },
      }),
      app.inject({
        method: 'GET',
        url: `/classrooms/${owned.id}/artifacts/${current.latestArtifact.id}`,
        headers: { cookie: cookies.get('user') },
      }),
      app.inject({ method: 'GET', url: '/classrooms', headers: { cookie: cookies.get('user') } }),
    ]);
    expect(previous.json().document.stage.name).toBe('分数入门');
    expect(latest.json().document.stage.name).toBe('分数的加减法');
    expect(list.json().classrooms[0].latestArtifact).toMatchObject(current.latestArtifact);
  });

  it('keeps media references stable and resolves them after owner authorization', async () => {
    const document = classroomDocument('media-stage', '图形的平移') as any;
    document.scenes[0]!.content.canvas.elements.push({
      id: 'translation-diagram',
      type: 'image',
      mediaRef: 'media/translation.png',
    });
    const service = new ClassroomService(getDb(), objectStorage);

    const imported = await service.importClassroom(userIdByRole.get('user')!, {
      sourceKey: 'integration-media-classroom',
      title: '图形的平移',
      document,
      media: [{
        path: 'media/translation.png',
        contentType: 'image/png',
        body: Buffer.from('known-image-bytes'),
      }],
    });

    const response = await app.inject({
      method: 'GET',
      url: `/classrooms/${imported.id}/artifacts/${imported.latestArtifact.id}`,
      headers: { cookie: cookies.get('user') },
    });
    expect(response.statusCode).toBe(200);
    const element = response.json().document.scenes[0].content.canvas.elements[0];
    expect(element).toMatchObject({
      mediaRef: 'media/translation.png',
      src: expect.stringMatching(/^https:\/\/media\.example\.test\/classrooms\/[^/]+\/[^/]+\/artifacts\/[^/]+\/media\/translation\.png$/),
    });
    expect([...objects.entries()]).toEqual(expect.arrayContaining([
      [expect.stringMatching(/\/media\/translation\.png$/), Buffer.from('known-image-bytes')],
    ]));
  });
});
