import { eq, and } from 'drizzle-orm';
import type { Database } from '../client';
import { customProviders } from '../schema/index';
import { AuthRequiredError, OwnershipError } from '../errors';

export function createCustomProvidersDal(db: Database) {
  return {
    async list(userId: string) {
      if (!userId) throw new AuthRequiredError();

      return db
        .select()
        .from(customProviders)
        .where(eq(customProviders.userId, userId));
    },

    async getById(userId: string, providerId: string) {
      if (!userId) throw new AuthRequiredError();

      const result = await db
        .select()
        .from(customProviders)
        .where(
          and(
            eq(customProviders.id, providerId),
            eq(customProviders.userId, userId),
          ),
        )
        .limit(1);

      if (!result[0]) {
        throw new OwnershipError('custom_provider', providerId);
      }

      return result[0];
    },

    async create(userId: string, data: {
      name: string;
      baseUrl: string;
      apiKeyEnc?: string;
      api?: string;
      modelIds?: unknown;
      enabled?: boolean;
    }) {
      if (!userId) throw new AuthRequiredError();

      const result = await db
        .insert(customProviders)
        .values({
          userId,
          ...data,
        })
        .returning();

      return result[0]!;
    },

    async update(userId: string, providerId: string, data: {
      name?: string;
      baseUrl?: string;
      apiKeyEnc?: string;
      api?: string;
      modelIds?: unknown;
      enabled?: boolean;
    }) {
      if (!userId) throw new AuthRequiredError();

      const result = await db
        .update(customProviders)
        .set(data)
        .where(
          and(
            eq(customProviders.id, providerId),
            eq(customProviders.userId, userId),
          ),
        )
        .returning();

      if (!result[0]) {
        throw new OwnershipError('custom_provider', providerId);
      }

      return result[0];
    },

    async delete(userId: string, providerId: string) {
      if (!userId) throw new AuthRequiredError();

      const result = await db
        .delete(customProviders)
        .where(
          and(
            eq(customProviders.id, providerId),
            eq(customProviders.userId, userId),
          ),
        )
        .returning();

      if (!result[0]) {
        throw new OwnershipError('custom_provider', providerId);
      }

      return result[0];
    },
  };
}
