import { eq, and } from 'drizzle-orm';
import type { Database } from '../client';
import { mcpServers } from '../schema/index';
import { AuthRequiredError, OwnershipError } from '../errors';

export function createMcpServersDal(db: Database) {
  return {
    async list(userId: string) {
      if (!userId) throw new AuthRequiredError();

      return db
        .select()
        .from(mcpServers)
        .where(eq(mcpServers.userId, userId));
    },

    async getById(userId: string, serverId: string) {
      if (!userId) throw new AuthRequiredError();

      const result = await db
        .select()
        .from(mcpServers)
        .where(
          and(
            eq(mcpServers.id, serverId),
            eq(mcpServers.userId, userId),
          ),
        )
        .limit(1);

      if (!result[0]) {
        throw new OwnershipError('mcp_server', serverId);
      }

      return result[0];
    },

    async create(userId: string, data: {
      name: string;
      transport: string;
      command?: string;
      args?: unknown;
      url?: string;
      env?: unknown;
      enabled?: boolean;
    }) {
      if (!userId) throw new AuthRequiredError();

      const result = await db
        .insert(mcpServers)
        .values({
          userId,
          ...data,
        })
        .returning();

      return result[0]!;
    },

    async update(userId: string, serverId: string, data: {
      name?: string;
      command?: string;
      args?: unknown;
      url?: string;
      env?: unknown;
      enabled?: boolean;
    }) {
      if (!userId) throw new AuthRequiredError();

      const result = await db
        .update(mcpServers)
        .set(data)
        .where(
          and(
            eq(mcpServers.id, serverId),
            eq(mcpServers.userId, userId),
          ),
        )
        .returning();

      if (!result[0]) {
        throw new OwnershipError('mcp_server', serverId);
      }

      return result[0];
    },

    async delete(userId: string, serverId: string) {
      if (!userId) throw new AuthRequiredError();

      const result = await db
        .delete(mcpServers)
        .where(
          and(
            eq(mcpServers.id, serverId),
            eq(mcpServers.userId, userId),
          ),
        )
        .returning();

      if (!result[0]) {
        throw new OwnershipError('mcp_server', serverId);
      }

      return result[0];
    },
  };
}
