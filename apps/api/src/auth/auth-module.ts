import { createHash, randomBytes } from 'node:crypto';

import { compare, hash } from 'bcryptjs';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { ApiConfig } from '../config';
import type { Database } from '../db/client';
import { AuthRequiredError, PermissionDeniedError } from '../db/errors';
import { authSessions, authUsers } from '../db/schema';

const credentialsSchema = z.object({
  email: z.string().trim().min(1).max(320).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(1_000),
});

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: 'admin' | 'user';
};

type SessionCookieConfig = ApiConfig['sessionCookie'];

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function publicUser(user: typeof authUsers.$inferSelect): AuthenticatedUser {
  return { id: user.id, email: user.email, name: user.name, image: user.image, role: user.role };
}

const developmentAccounts = [
  { alias: 'admin', email: 'admin@chalk.local', password: 'admin123', role: 'admin' as const, name: 'Chalk 管理员' },
  { alias: 'user', email: 'user@chalk.local', password: 'user123', role: 'user' as const, name: '林同学' },
];

export class AuthModule {
  constructor(
    private readonly db: Database,
    private readonly config: ApiConfig,
  ) {}

  async login(input: unknown) {
    const credentials = credentialsSchema.parse(input);
    const isDevelopmentAccount = this.config.nodeEnv !== 'production' && developmentAccounts.some((candidate) =>
      (credentials.email === candidate.alias || credentials.email === candidate.email) &&
      credentials.password === candidate.password,
    );
    const user = isDevelopmentAccount
      ? await this.ensureDevelopmentUser(credentials.email, credentials.password)
      : (await this.findUser(credentials.email)) ??
        (await this.ensureDevelopmentUser(credentials.email, credentials.password));

    if (!user?.passwordHash || !(await compare(credentials.password, user.passwordHash))) {
      return null;
    }

    const token = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + this.config.sessionCookie.ttlDays * 86_400_000);
    await this.db.delete(authSessions).where(lt(authSessions.expires, new Date()));
    await this.db.insert(authSessions).values({
      sessionToken: tokenHash(token),
      userId: user.id,
      expires,
    });

    return { token, expires, user: publicUser(user) };
  }

  async optionalUser(request: FastifyRequest): Promise<AuthenticatedUser | null> {
    const token = request.cookies[this.config.sessionCookie.name];
    if (!token) return null;

    const rows = await this.db
      .select({ user: authUsers })
      .from(authSessions)
      .innerJoin(authUsers, eq(authSessions.userId, authUsers.id))
      .where(
        and(
          eq(authSessions.sessionToken, tokenHash(token)),
          gt(authSessions.expires, new Date()),
        ),
      )
      .limit(1);

    return rows[0] ? publicUser(rows[0].user) : null;
  }

  async requireUser(request: FastifyRequest) {
    const user = await this.optionalUser(request);
    if (!user) throw new AuthRequiredError();
    return user;
  }

  async logout(request: FastifyRequest) {
    const token = request.cookies[this.config.sessionCookie.name];
    if (!token) return;
    await this.db
      .delete(authSessions)
      .where(eq(authSessions.sessionToken, tokenHash(token)));
  }

  setSessionCookie(reply: FastifyReply, token: string, expires: Date) {
    reply.setCookie(this.config.sessionCookie.name, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.sessionCookie.secure,
      path: '/',
      expires,
    });
  }

  clearSessionCookie(reply: FastifyReply) {
    reply.clearCookie(this.config.sessionCookie.name, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.sessionCookie.secure,
      path: '/',
    });
  }

  private async findUser(email: string) {
    const rows = await this.db
      .select()
      .from(authUsers)
      .where(eq(authUsers.email, email))
      .limit(1);
    return rows[0] ?? null;
  }

  private async ensureDevelopmentUser(email: string, password: string) {
    if (this.config.nodeEnv === 'production') return null;
    const account = developmentAccounts.find((candidate) =>
      (email === candidate.alias || email === candidate.email) && password === candidate.password,
    );
    if (account) {
      await this.db
        .insert(authUsers)
        .values({
          email: account.email,
          passwordHash: await hash(account.password, 12),
          name: account.name,
          role: account.role,
        })
        .onConflictDoUpdate({
          target: authUsers.email,
          set: {
            passwordHash: await hash(account.password, 12),
            name: account.name,
            role: account.role,
          },
        });
      return this.findUser(account.email);
    }
    const developmentEmail = (process.env.DEV_USER_EMAIL ?? 'dev@chalk.local').toLowerCase();
    const developmentPassword = process.env.DEV_USER_PASSWORD ?? 'chalk-dev-2026';
    if (email !== developmentEmail || password !== developmentPassword) return null;

    await this.db
      .insert(authUsers)
      .values({
        email: developmentEmail,
        passwordHash: await hash(developmentPassword, 12),
        name: '林同学',
        role: 'user',
      })
      .onConflictDoNothing({ target: authUsers.email });
    return this.findUser(developmentEmail);
  }

  async requireRole(request: FastifyRequest, role: AuthenticatedUser['role']) {
    const user = await this.requireUser(request);
    if (user.role !== role) {
      throw new PermissionDeniedError();
    }
    return user;
  }

  requireAdmin(request: FastifyRequest) {
    return this.requireRole(request, 'admin');
  }
}

export function registerAuthRoutes(app: FastifyInstance, auth: AuthModule) {
  app.post('/auth/login', async (request, reply) => {
    const session = await auth.login(request.body);
    if (!session) {
      return reply.code(401).send({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }
    auth.setSessionCookie(reply, session.token, session.expires);
    return { user: session.user };
  });

  app.get('/auth/session', async (request) => ({ user: await auth.optionalUser(request) }));

  app.post('/auth/logout', async (request, reply) => {
    await auth.logout(request);
    auth.clearSessionCookie(reply);
    return { ok: true };
  });
}
