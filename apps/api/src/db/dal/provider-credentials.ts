import { eq, and } from 'drizzle-orm';
import type { Database } from '../client';
import { agentSettings, providerCredentials } from '../schema/index';
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

    async upsert(userId: string, providerId: string, apiKeyEnc: string | null, baseUrl: string | null = null, settings: unknown = null) {
      if (!userId) throw new AuthRequiredError();

      const result = await db
        .insert(providerCredentials)
        .values({ userId, providerId, apiKeyEnc, baseUrl, settings })
        .onConflictDoUpdate({
          target: [providerCredentials.userId, providerCredentials.providerId],
          set: { apiKeyEnc, baseUrl, settings, updatedAt: new Date() },
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

    async deleteMediaAndClearDefault(userId: string, capability: 'image' | 'video', providerId: string) {
      if (!userId) throw new AuthRequiredError();
      return db.transaction(async (transaction) => {
        const result = await transaction
          .delete(providerCredentials)
          .where(and(
            eq(providerCredentials.userId, userId),
            eq(providerCredentials.providerId, `media:${capability}:${providerId}`),
          ))
          .returning();
        if (!result[0]) throw new OwnershipError('provider_credential', providerId);
        const selection = capability === 'image'
          ? { defaultImageProviderId: null, defaultImageModelId: null }
          : { defaultVideoProviderId: null, defaultVideoModelId: null };
        await transaction
          .update(agentSettings)
          .set({ ...selection, updatedAt: new Date() })
          .where(and(
            eq(agentSettings.userId, userId),
            capability === 'image'
              ? eq(agentSettings.defaultImageProviderId, providerId)
              : eq(agentSettings.defaultVideoProviderId, providerId),
          ));
        return result[0];
      });
    },
  };
}
