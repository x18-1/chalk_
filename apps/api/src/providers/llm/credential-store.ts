import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore,
} from '@earendil-works/pi-ai';
import { and, eq } from 'drizzle-orm';

import type { Database } from '../../db';
import { providerCredentials } from '../../db';
import { decrypt, encrypt } from '../../security/credential-encryption';

export class DrizzleCredentialStore implements CredentialStore {
  private locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly db: Database,
    private readonly userId: string,
  ) {
    if (!userId) throw new Error('DrizzleCredentialStore requires a userId');
  }

  async read(
    providerId: string,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();

    const row = await this.db
      .select()
      .from(providerCredentials)
      .where(
        and(
          eq(providerCredentials.userId, this.userId),
          eq(providerCredentials.providerId, providerId),
        ),
      )
      .limit(1);

    if (!row[0]?.apiKeyEnc) return undefined;

    const key = decrypt(row[0].apiKeyEnc);
    return { type: 'api_key', key };
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();

    const rows = await this.db
      .select({ providerId: providerCredentials.providerId })
      .from(providerCredentials)
      .where(eq(providerCredentials.userId, this.userId));

    return rows.map((row) => ({ providerId: row.providerId, type: 'api_key' as const }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    const previous = this.locks.get(providerId) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      options?.signal?.throwIfAborted();
      const current = await this.read(providerId, options);
      const next = await fn(current);
      if (next === undefined) return current;

      if (next.type !== 'api_key') {
        throw new Error('DrizzleCredentialStore only supports api_key credentials');
      }

      const apiKeyEnc = next.key ? encrypt(next.key) : null;

      await this.db
        .insert(providerCredentials)
        .values({ userId: this.userId, providerId, apiKeyEnc })
        .onConflictDoUpdate({
          target: [providerCredentials.userId, providerCredentials.providerId],
          set: { apiKeyEnc, updatedAt: new Date() },
        });

      return next;
    });

    this.locks.set(providerId, task.catch(() => {}));
    return task as Promise<Credential | undefined>;
  }

  async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    const previous = this.locks.get(providerId) ?? Promise.resolve();
    const task = previous.catch(() => {}).then(async () => {
      options?.signal?.throwIfAborted();
      await this.db
        .delete(providerCredentials)
        .where(
          and(
            eq(providerCredentials.userId, this.userId),
            eq(providerCredentials.providerId, providerId),
          ),
        );
    });
    this.locks.set(providerId, task);
    return task;
  }
}
