import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: join(process.cwd(), '../../.env '), quiet: true });

import { buildApi } from '../../src/app';
import { loadConfig } from '../../src/config';
import { closeDb, getDb } from '../../src/db/client';
import { authUsers } from '../../src/db/schema';

describe('admin user management read boundary', () => {
  const suffix = randomUUID();
  const adminEmail = `admin-${suffix}@chalk.local`;
  const userEmail = `student-${suffix}@chalk.local`;
  const password = `password-${suffix}`;
  let app: Awaited<ReturnType<typeof buildApi>>;
  let adminId: string;
  let userId: string;
  let adminCookie: string;
  let userCookie: string;

  function cookieFrom(response: { headers: { 'set-cookie'?: string | string[] | undefined } }) {
    const value = response.headers['set-cookie'];
    const first = Array.isArray(value) ? value[0] : value;
    return first?.split(';', 1)[0] ?? '';
  }

  beforeAll(async () => {
    const db = getDb();
    const rows = await db.insert(authUsers).values([
      { email: adminEmail, passwordHash: await hash(password, 4), role: 'admin', name: '测试管理员' },
      { email: userEmail, passwordHash: await hash(password, 4), role: 'user', name: '测试学生' },
    ]).returning({ id: authUsers.id });
    adminId = rows[0]!.id;
    userId = rows[1]!.id;
    app = await buildApi({
      config: loadConfig({
        NODE_ENV: 'test',
        SESSION_COOKIE_NAME: `admin_users_${suffix}`,
        SESSION_COOKIE_SECURE: 'false',
      }),
    });

    const [adminLogin, userLogin] = await Promise.all([
      app.inject({ method: 'POST', url: '/auth/login', payload: { email: adminEmail, password } }),
      app.inject({ method: 'POST', url: '/auth/login', payload: { email: userEmail, password } }),
    ]);
    expect(adminLogin.statusCode).toBe(200);
    expect(userLogin.statusCode).toBe(200);
    adminCookie = cookieFrom(adminLogin);
    userCookie = cookieFrom(userLogin);
  });

  afterAll(async () => {
    await app?.close();
    if (adminId || userId) {
      await getDb().delete(authUsers).where(eq(authUsers.id, adminId || userId));
      if (adminId && userId) await getDb().delete(authUsers).where(eq(authUsers.id, userId));
    }
    await closeDb();
  });

  it('requires authentication and an admin role', async () => {
    await expect(app.inject({ method: 'GET', url: '/admin/users' })).resolves.toMatchObject({ statusCode: 401 });
    await expect(app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { cookie: userCookie },
    })).resolves.toMatchObject({ statusCode: 403 });
  });

  it('returns safe user summaries and supports admin filters', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/users?q=测试学生&role=user',
      headers: { cookie: adminCookie },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      users: Array<Record<string, unknown>>;
      total: number;
      limit: number;
      offset: number;
    };
    expect(body.total).toBe(1);
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toMatchObject({ id: userId, email: userEmail, name: '测试学生', role: 'user' });
    expect(body.users[0]).not.toHaveProperty('passwordHash');
    expect(body.users[0]).not.toHaveProperty('sessionToken');
    expect(body).toMatchObject({ limit: 50, offset: 0 });
  });

  it('does not expose users outside the requested filter', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/users?role=admin&limit=1&offset=0',
      headers: { cookie: adminCookie },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { users: Array<{ role: string }> };
    expect(body.users.every((user) => user.role === 'admin')).toBe(true);
  });
});
