import { createHash, randomBytes } from 'node:crypto';

import { compare, hash } from 'bcryptjs';
import { and, eq, gt, lt } from 'drizzle-orm';

import type { ApiConfig } from '../config';
import type { Database } from '../db/client';
import { authSessions, authUsers } from '../db/schema';
import type { AuthenticatedUser, LoginCredentials } from './types';

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function publicUser(user: typeof authUsers.$inferSelect): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    role: user.role,
  };
}

const developmentAccounts = [
  {
    alias: 'admin',
    email: 'admin@chalk.local',
    password: 'admin123',
    role: 'admin' as const,
    name: 'Chalk 管理员',
  },
  {
    alias: 'user',
    email: 'user@chalk.local',
    password: 'user123',
    role: 'user' as const,
    name: '林同学',
  },
];

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly config: ApiConfig,
  ) {}

  async login(credentials: LoginCredentials) {
    const isDevelopmentAccount = this.config.nodeEnv !== 'production' &&
      developmentAccounts.some((candidate) =>
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
    const expires = new Date(
      Date.now() + this.config.sessionCookie.ttlDays * 86_400_000,
    );
    await this.db.delete(authSessions).where(lt(authSessions.expires, new Date()));
    await this.db.insert(authSessions).values({
      sessionToken: tokenHash(token),
      userId: user.id,
      expires,
    });

    return { token, expires, user: publicUser(user) };
  }

  async findSessionUser(token: string): Promise<AuthenticatedUser | null> {
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

  async deleteSession(token: string) {
    await this.db
      .delete(authSessions)
      .where(eq(authSessions.sessionToken, tokenHash(token)));
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
      (email === candidate.alias || email === candidate.email) &&
      password === candidate.password,
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

    const developmentEmail = (process.env.DEV_USER_EMAIL ?? 'dev@chalk.local')
      .toLowerCase();
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
}
