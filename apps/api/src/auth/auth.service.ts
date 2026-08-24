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

const legacyDevelopmentEmails = new Set([
  'admin@chalk.local',
  'user@chalk.local',
  'dev@chalk.local',
]);

function requiredDevelopmentValue(name: string) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} env var is not set`);
  return value;
}

function loadDevelopmentAccounts() {
  return [
    {
      email: requiredDevelopmentValue('DEV_ADMIN_EMAIL').trim().toLowerCase(),
      password: requiredDevelopmentValue('DEV_ADMIN_PASSWORD'),
      role: 'admin' as const,
      name: 'Chalk 管理员',
    },
    {
      email: requiredDevelopmentValue('DEV_USER_EMAIL').trim().toLowerCase(),
      password: requiredDevelopmentValue('DEV_USER_PASSWORD'),
      role: 'user' as const,
      name: '林同学',
    },
  ];
}

export class AuthService {
  constructor(
    private readonly db: Database,
    private readonly config: ApiConfig,
  ) {}

  async login(credentials: LoginCredentials) {
    const developmentAccounts = this.config.nodeEnv === 'production'
      ? []
      : loadDevelopmentAccounts();
    if (
      this.config.nodeEnv !== 'production' &&
      legacyDevelopmentEmails.has(credentials.email)
    ) {
      return null;
    }
    const isDevelopmentAccount = developmentAccounts.some((candidate) =>
      credentials.email === candidate.email && credentials.password === candidate.password,
    );
    const user = isDevelopmentAccount
      ? await this.ensureDevelopmentUser(credentials.email, developmentAccounts)
      : await this.findUser(credentials.email);

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

  private async ensureDevelopmentUser(
    email: string,
    accounts: ReturnType<typeof loadDevelopmentAccounts>,
  ) {
    if (this.config.nodeEnv === 'production') return null;
    const account = accounts.find((candidate) => email === candidate.email);
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
    return null;
  }
}
