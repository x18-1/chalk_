import { and, eq } from 'drizzle-orm';
import type { Database } from '../client';
import { userSkills } from '../schema';
import { AuthRequiredError, OwnershipError } from '../errors';

function requireUserId(userId: string) { if (!userId) throw new AuthRequiredError(); }

export function createUserSkillsDal(db: Database) {
  return {
    async list(userId: string) {
      requireUserId(userId);
      return db.select().from(userSkills).where(eq(userSkills.userId, userId));
    },
    async get(userId: string, id: string) {
      requireUserId(userId);
      const rows = await db.select().from(userSkills).where(and(eq(userSkills.userId, userId), eq(userSkills.id, id))).limit(1);
      if (!rows[0]) throw new OwnershipError('user_skill', id);
      return rows[0];
    },
    async create(userId: string, data: { name: string; description: string; content: string; references?: unknown; version: string; contentHash: string; enabled?: boolean }) {
      requireUserId(userId);
      const rows = await db.insert(userSkills).values({ userId, ...data }).returning();
      return rows[0]!;
    },
    async update(userId: string, id: string, data: Partial<{ name: string; description: string; content: string; references: unknown; version: string; contentHash: string; enabled: boolean }>) {
      requireUserId(userId);
      const rows = await db.update(userSkills).set({ ...data, updatedAt: new Date() }).where(and(eq(userSkills.userId, userId), eq(userSkills.id, id))).returning();
      if (!rows[0]) throw new OwnershipError('user_skill', id);
      return rows[0];
    },
    async delete(userId: string, id: string) {
      requireUserId(userId);
      const rows = await db.delete(userSkills).where(and(eq(userSkills.userId, userId), eq(userSkills.id, id))).returning();
      if (!rows[0]) throw new OwnershipError('user_skill', id);
      return rows[0];
    },
  };
}
