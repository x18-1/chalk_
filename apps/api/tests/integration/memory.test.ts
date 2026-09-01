import { randomUUID } from 'node:crypto';
import { hash } from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApi } from '../../src/app';
import { loadConfig } from '../../src/config';
import { closeDb, getDb } from '../../src/db/client';
import { authUsers, memoryEvents } from '../../src/db/schema';

describe('memory API ownership and lifecycle', () => {
  const suffix = randomUUID(); const password = 'memory-test-password';
  const emails = [`memory-a-${suffix}@chalk.local`, `memory-b-${suffix}@chalk.local`];
  let app: Awaited<ReturnType<typeof buildApi>>; let ids: string[]; let cookies: string[];
  const cookieFrom = (response: { headers: { 'set-cookie'?: string | string[] } }) => { const value = response.headers['set-cookie']; const first = Array.isArray(value) ? value[0] : value; return first?.split(';', 1)[0] ?? ''; };
  beforeAll(async () => {
    ids = (await getDb().insert(authUsers).values(await Promise.all(emails.map(async (email) => ({ email, passwordHash: await hash(password, 4), role: 'user' as const, name: '记忆测试' })))).returning({ id: authUsers.id })).map((row) => row.id);
    app = await buildApi({ config: loadConfig({ NODE_ENV: 'test', SESSION_COOKIE_NAME: `memory_${suffix}`, SESSION_COOKIE_SECURE: 'false' }) });
    cookies = await Promise.all(emails.map(async (email) => cookieFrom(await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } }))));
  });
  afterAll(async () => { await app?.close(); if (ids?.length) await getDb().delete(authUsers).where(eq(authUsers.id, ids[0]!)); if (ids?.[1]) await getDb().delete(authUsers).where(eq(authUsers.id, ids[1]!)); await closeDb(); });

  it('fails closed and isolates entries by owner', async () => {
    expect((await app.inject({ method: 'GET', url: '/memory' })).statusCode).toBe(401);
    const event = (await getDb().insert(memoryEvents).values({ userId: ids[0]!, surface: 'chat', kind: 'message', payload: { text: '喜欢例题' } }).returning({ id: memoryEvents.id }))[0]!;
    const created = await app.inject({ method: 'POST', url: '/memory/entries', headers: { cookie: cookies[0]! }, payload: { layer: 'L2', surface: 'chat', section: '偏好', text: '喜欢例题', refs: [event.id] } });
    expect(created.statusCode).toBe(201); const entryId = (created.json() as { entry: { id: string } }).entry.id;
    expect((await app.inject({ method: 'GET', url: `/memory/entries/${entryId}`, headers: { cookie: cookies[1]! } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/memory/entries/${entryId}`, headers: { cookie: cookies[0]! } })).statusCode).toBe(200);
    expect(((await app.inject({ method: 'GET', url: '/memory', headers: { cookie: cookies[0]! } })).json() as { entries: unknown[] }).entries).toHaveLength(0);
  });

  it('persists the per-owner L3 injection preference', async () => {
    expect((await app.inject({ method: 'GET', url: '/settings', headers: { cookie: cookies[0]! } })).json()).toMatchObject({ memoryInjectionEnabled: true });
    expect((await app.inject({ method: 'PUT', url: '/settings/memory', headers: { cookie: cookies[0]! }, payload: { enabled: false } })).json()).toEqual({ memoryInjectionEnabled: false });
    expect((await app.inject({ method: 'GET', url: '/settings', headers: { cookie: cookies[0]! } })).json()).toMatchObject({ memoryInjectionEnabled: false });
    await app.inject({ method: 'PUT', url: '/settings/memory', headers: { cookie: cookies[0]! }, payload: { enabled: true } });
  });
});
