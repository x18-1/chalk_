import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm';

import type { Database } from '../client';
import { AuthRequiredError, PermissionDeniedError } from '../errors';
import { authUsers } from '../schema';

export type AdminUserListFilters = {
  query?: string;
  role?: 'admin' | 'user';
  limit?: number;
  offset?: number;
};

export type AdminUserSummary = {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'user';
  createdAt: Date;
};

const totalCount = count().as('total_count');

export function createAuthUsersDal(db: Database) {
  async function requireAdmin(adminUserId: string) {
    if (!adminUserId) throw new AuthRequiredError();
    const rows = await db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(and(eq(authUsers.id, adminUserId), eq(authUsers.role, 'admin')))
      .limit(1);
    if (!rows[0]) throw new PermissionDeniedError();
  }

  function whereClause(filters: AdminUserListFilters) {
    const conditions = [];
    if (filters.role) conditions.push(eq(authUsers.role, filters.role));
    if (filters.query) {
      const pattern = `%${filters.query}%`;
      conditions.push(or(ilike(authUsers.email, pattern), ilike(authUsers.name, pattern)));
    }
    return conditions.length ? and(...conditions) : undefined;
  }

  return {
    async listForAdmin(adminUserId: string, filters: AdminUserListFilters = {}) {
      await requireAdmin(adminUserId);
      const limit = filters.limit ?? 50;
      const offset = filters.offset ?? 0;
      const where = whereClause(filters);
      const [rows, totalRows] = await Promise.all([
        db
          .select({
            id: authUsers.id,
            email: authUsers.email,
            name: authUsers.name,
            role: authUsers.role,
            createdAt: authUsers.createdAt,
          })
          .from(authUsers)
          .where(where)
          .orderBy(desc(authUsers.createdAt), asc(authUsers.email))
          .limit(limit)
          .offset(offset),
        db.select({ total: totalCount }).from(authUsers).where(where),
      ]);

      return {
        users: rows as AdminUserSummary[],
        total: Number(totalRows[0]?.total ?? 0),
        limit,
        offset,
      };
    },
  };
}
