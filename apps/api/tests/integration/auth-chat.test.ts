import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { config as loadDotenv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

loadDotenv({ path: join(process.cwd(), '../../.env ') });

import { buildApi } from '../../src/app';
import { loadConfig } from '../../src/config';
import { closeDb, getDb } from '../../src/db/client';
import { createAttachmentsDal, createSubagentRunsDal } from '../../src/db/dal';
import { OwnershipError } from '../../src/db/errors';
import { authUsers, conversations } from '../../src/db/schema';
import { createSession, deleteSession } from '../../src/agent/runtime-manager';

const email = `api-test-${randomBytes(6).toString('hex')}@chalk.local`;
const password = `test-${randomBytes(12).toString('hex')}`;
let sessionRoot: string;
let app: Awaited<ReturnType<typeof buildApi>>;
let userId: string;
let cookie: string;

function responseCookie(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.split(';', 1)[0] ?? '';
}

describe('API auth and chat interface', () => {
  beforeAll(async () => {
    sessionRoot = await mkdtemp(join(tmpdir(), 'chalk-api-test-'));
    process.env.DEV_USER_EMAIL = email;
    process.env.DEV_USER_PASSWORD = password;
    process.env.SESSIONS_ROOT = join(sessionRoot, 'sessions');
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    app = await buildApi({
      config: loadConfig({
        NODE_ENV: 'test',
        API_HOST: '127.0.0.1',
        API_PORT: '3011',
        WEB_ORIGIN: 'http://localhost:3000',
        SESSION_COOKIE_NAME: 'chalk_test_session',
        SESSION_COOKIE_SECURE: 'false',
        SESSION_TTL_DAYS: '1',
      }),
    });
  });

  afterAll(async () => {
    const db = getDb();
    if (userId) {
      const rows = await db.select({ id: conversations.id, sessionId: conversations.sessionId })
        .from(conversations)
        .where(eq(conversations.userId, userId));
      await Promise.all(rows.map((row) => deleteSession(row.sessionId).catch(() => undefined)));
      await db.delete(authUsers).where(eq(authUsers.id, userId));
    }
    await app.close();
    await closeDb();
    await rm(sessionRoot, { recursive: true, force: true });
  });

  it('fails closed without a session cookie', async () => {
    const response = await app.inject({ method: 'GET', url: '/chat' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('logs in, exposes the session, and scopes conversations to the owner', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    cookie = responseCookie(login.headers['set-cookie']);
    expect(cookie).toContain('chalk_test_session=');
    userId = login.json().user.id;

    const session = await app.inject({ method: 'GET', url: '/auth/session', headers: { cookie } });
    expect(session.statusCode).toBe(200);
    expect(session.json().user.id).toBe(userId);

    const created = await app.inject({ method: 'POST', url: '/chat', headers: { cookie }, payload: {} });
    expect(created.statusCode).toBe(201);
    const conversationId = created.json().conversation.id as string;

    const messages = await app.inject({ method: 'GET', url: `/chat/${conversationId}/messages`, headers: { cookie } });
    expect(messages.statusCode).toBe(200);
    expect(messages.json().messages).toEqual([]);

    const emptyJsonBody = await app.inject({
      method: 'DELETE',
      url: `/chat/${conversationId}`,
      headers: { cookie, 'content-type': 'application/json' },
    });
    expect(emptyJsonBody.statusCode).toBe(400);
    expect(emptyJsonBody.json()).toMatchObject({ code: 'INVALID_REQUEST' });

    const missingSession = await app.inject({ method: 'POST', url: '/chat', headers: { cookie }, payload: {} });
    expect(missingSession.statusCode).toBe(201);
    await deleteSession(missingSession.json().conversation.sessionId);
    const missingSessionMessages = await app.inject({
      method: 'GET',
      url: `/chat/${missingSession.json().conversation.id}/messages`,
      headers: { cookie },
    });
    expect(missingSessionMessages.statusCode).toBe(404);
    expect(missingSessionMessages.json()).toMatchObject({ code: 'SESSION_NOT_FOUND' });

    const foreign = await app.inject({ method: 'GET', url: `/chat/${randomBytes(16).toString('hex')}`, headers: { cookie } });
    expect(foreign.statusCode).toBe(400);

    const missing = await app.inject({ method: 'GET', url: `/chat/00000000-0000-4000-8000-000000000000`, headers: { cookie } });
    expect(missing.statusCode).toBe(404);

    const foreignUser = (await getDb().insert(authUsers).values({ email: `foreign-${randomBytes(6).toString('hex')}@chalk.local` }).returning())[0]!;
    const foreignSession = await createSession(foreignUser.id);
    const foreignConversation = (await getDb().insert(conversations).values({
      userId: foreignUser.id,
      sessionId: foreignSession.descriptor.id,
      sessionFilePath: foreignSession.descriptor.path,
    }).returning())[0]!;
    const forbidden = await app.inject({ method: 'GET', url: `/chat/${foreignConversation.id}`, headers: { cookie } });
    expect(forbidden.statusCode).toBe(404);
    await expect(createAttachmentsDal(getDb()).create(userId, {
      conversationId: foreignConversation.id,
      fileKey: `${userId}/foreign-attachment`,
      filename: 'foreign.png',
      contentType: 'image/png',
      size: 1,
    })).rejects.toBeInstanceOf(OwnershipError);
    await expect(createSubagentRunsDal(getDb()).start(userId, {
      conversationId: foreignConversation.id,
      parentSessionId: 'parent',
      childSessionId: 'child',
      timeoutMs: 1_000,
    })).rejects.toBeInstanceOf(OwnershipError);
    await getDb().delete(authUsers).where(eq(authUsers.id, foreignUser.id));
    await deleteSession(foreignSession.descriptor.id);
  });

  it('rejects a disallowed browser origin before mutating routes', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/chat',
      headers: { cookie, origin: 'https://attacker.example' },
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'ORIGIN_NOT_ALLOWED' });
  });

  it('rejects credential-bearing MCP URLs at the API seam', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { cookie },
      payload: {
        name: 'unsafe',
        transport: 'http',
        url: 'https://user:password@example.com/mcp',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
