import { eq, and } from 'drizzle-orm';
import type { Database } from '../client';
import { providerCredentials } from '../schema/index';
import { AuthRequiredError, OwnershipError } from '../errors';

export function createProviderCredentialsDal(db: Database) {
  return {
    async list(userId: string) {
      if (!userId) throw new AuthRequiredError();

      return db
        .select()
        .from(providerCredentials)
        .where(eq(providerCredentials.userId, userId));
    },

    async getByProvider(userId: string, providerId: string) {
      if (!userId) throw new AuthRequiredError();

      const result = await db
        .select()
        .from(providerCredentials)
        .where(
          and(
            eq(providerCredentials.userId, userId),
            eq(providerCredentials.providerId, providerId),
          ),
        )
        .limit(1);

      return result[0] ?? null;
    },

    async upsert(userId: string, providerId: string, apiKeyEnc: string) {
      if (!userId) throw new AuthRequiredError();

      const result = await db
        .insert(providerCredentials)
        .values({ userId, providerId, apiKeyEnc })
        .onConflictDoUpdate({
          target: [providerCredentials.userId, providerCredentials.providerId],
          set: { apiKeyEnc, updatedAt: new Date() },
        })
        .returning();

      return result[0]!;
    },

    async delete(userId: string, providerId: string) {
      if (!userId) throw new AuthRequiredError();

      const result = await db
        .delete(providerCredentials)
        .where(
          and(
            eq(providerCredentials.userId, userId),
            eq(providerCredentials.providerId, providerId),
          ),
        )
        .returning();

      if (!result[0]) {
        throw new OwnershipError('provider_credential', providerId);
      }

      return result[0];
    },
  };
}
