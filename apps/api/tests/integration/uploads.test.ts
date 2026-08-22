import { randomUUID } from 'node:crypto';

import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApi } from '../../src/app';
import { loadConfig } from '../../src/config';
import { closeDb, getDb } from '../../src/db/client';
import { authUsers } from '../../src/db/schema';

describe('upload HTTP boundary', () => {
  const suffix = randomUUID();
  const email = `upload-${suffix}@chalk.local`;
  const password = `password-${suffix}`;
  let app: Awaited<ReturnType<typeof buildApi>>;
  let userId: string;
  let cookie: string;
  let conversationId: string;
  let objectMetadata = { size: 128, contentType: 'image/png' };

  const objectStorage = {
    publicUrl: (fileKey: string) => `https://cdn.example.test/${fileKey}`,
    createUploadUrl: async () => 'https://uploads.example.test/signed',
    inspectObject: async () => objectMetadata,
  };

  function responseCookie(value: string | string[] | undefined) {
    const first = Array.isArray(value) ? value[0] : value;
    return first?.split(';', 1)[0] ?? '';
  }

  beforeAll(async () => {
    const rows = await getDb()
      .insert(authUsers)
      .values({
        email,
        passwordHash: await hash(password, 4),
        role: 'user',
        name: '附件场景用户',
      })
      .returning({ id: authUsers.id });
    userId = rows[0]!.id;
    app = await buildApi({
      config: loadConfig({
        NODE_ENV: 'test',
        SESSION_COOKIE_NAME: `uploads_${suffix}`,
        SESSION_COOKIE_SECURE: 'false',
      }),
      objectStorage,
    });
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    cookie = responseCookie(login.headers['set-cookie']);

    const conversation = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { cookie },
      payload: { title: '图片上传测试' },
    });
    expect(conversation.statusCode).toBe(201);
    conversationId = conversation.json().conversation.id as string;
  });

  afterAll(async () => {
    await app?.close();
    if (userId) await getDb().delete(authUsers).where(eq(authUsers.id, userId));
    await closeDb();
  });

  beforeEach(() => {
    objectMetadata = { size: 128, contentType: 'image/png' };
  });

  it('lets a user reserve an upload for an owned conversation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { cookie },
      payload: {
        conversationId,
        filename: 'diagram 1.png',
        contentType: 'image/png',
        size: 128,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      attachmentId: string;
      fileKey: string;
      uploadUrl: string;
      expiresIn: number;
    };
    expect(body.attachmentId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.fileKey).toMatch(
      new RegExp(`^${userId}/${conversationId}/[0-9a-f-]{36}-diagram_1\\.png$`),
    );
    expect(body.uploadUrl).toBe('https://uploads.example.test/signed');
    expect(body.expiresIn).toBe(600);
  });

  it('marks an uploaded object as ready after its metadata matches', async () => {
    const reservation = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { cookie },
      payload: {
        conversationId,
        filename: 'worked-example.png',
        contentType: 'image/png',
        size: 128,
      },
    });
    expect(reservation.statusCode).toBe(200);
    const reserved = reservation.json() as {
      attachmentId: string;
      fileKey: string;
    };

    const response = await app.inject({
      method: 'POST',
      url: '/uploads/confirm',
      headers: { cookie },
      payload: { attachmentId: reserved.attachmentId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().attachment).toMatchObject({
      id: reserved.attachmentId,
      fileKey: reserved.fileKey,
      filename: 'worked-example.png',
      contentType: 'image/png',
      size: 128,
      status: 'ready',
      publicUrl: `https://cdn.example.test/${reserved.fileKey}`,
    });
  });

  it('rejects an uploaded object whose size differs from the reservation', async () => {
    const reservation = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { cookie },
      payload: {
        conversationId,
        filename: 'wrong-size.png',
        contentType: 'image/png',
        size: 128,
      },
    });
    expect(reservation.statusCode).toBe(200);
    const { attachmentId } = reservation.json() as { attachmentId: string };
    objectMetadata = { size: 64, contentType: 'image/png' };

    const response = await app.inject({
      method: 'POST',
      url: '/uploads/confirm',
      headers: { cookie },
      payload: { attachmentId },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'Uploaded file size does not match the reservation',
      code: 'UPLOAD_SIZE_MISMATCH',
    });
  });

  it('rejects an uploaded object whose type differs from the reservation', async () => {
    const reservation = await app.inject({
      method: 'POST',
      url: '/uploads/presign',
      headers: { cookie },
      payload: {
        conversationId,
        filename: 'wrong-type.png',
        contentType: 'image/png',
        size: 128,
      },
    });
    expect(reservation.statusCode).toBe(200);
    const { attachmentId } = reservation.json() as { attachmentId: string };
    objectMetadata = { size: 128, contentType: 'application/pdf' };

    const response = await app.inject({
      method: 'POST',
      url: '/uploads/confirm',
      headers: { cookie },
      payload: { attachmentId },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: 'Uploaded file type does not match the reservation',
      code: 'UPLOAD_TYPE_MISMATCH',
    });
  });
});
