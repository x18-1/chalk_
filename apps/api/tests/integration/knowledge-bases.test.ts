import { randomUUID } from 'node:crypto';

import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '../../src/db/client';
import { createKnowledgeBasesDal, createKnowledgeDocumentsDal } from '../../src/db/dal';
import { OwnershipError } from '../../src/db/errors';
import { authUsers } from '../../src/db/schema';

describe('knowledge base owner isolation', () => {
  const suffix = randomUUID();
  let ownerId: string;
  let otherId: string;
  let baseId: string;

  beforeAll(async () => {
    const rows = await getDb().insert(authUsers).values([
      { email: `rag-owner-${suffix}@chalk.local`, passwordHash: await hash('password', 4), role: 'user', name: 'RAG owner' },
      { email: `rag-other-${suffix}@chalk.local`, passwordHash: await hash('password', 4), role: 'user', name: 'RAG other' },
    ]).returning({ id: authUsers.id });
    ownerId = rows[0]!.id; otherId = rows[1]!.id;
    baseId = (await createKnowledgeBasesDal(getDb()).create(ownerId, { name: '代数资料' })).id;
  });

  afterAll(async () => {
    if (ownerId) await getDb().delete(authUsers).where(eq(authUsers.id, ownerId));
    if (otherId) await getDb().delete(authUsers).where(eq(authUsers.id, otherId));
    await closeDb();
  });

  it('does not reveal a knowledge base to another user', async () => {
    await expect(createKnowledgeBasesDal(getDb()).getById(otherId, baseId)).rejects.toBeInstanceOf(OwnershipError);
  });

  it('requires the owner when creating a document', async () => {
    await expect(createKnowledgeDocumentsDal(getDb()).create(otherId, {
      knowledgeBaseId: baseId,
      filename: 'secret.md',
      contentType: 'text/markdown',
      size: 10,
      fileKey: `forbidden/${suffix}`,
    })).rejects.toBeInstanceOf(OwnershipError);
  });
});
