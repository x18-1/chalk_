import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { config as loadDotenv } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

loadDotenv({ path: join(process.cwd(), '../../.env'), quiet: true });

import { closeDb, getDb } from '../../src/db/client';
import { createConversationsDal } from '../../src/db/dal';
import { authUsers, conversations } from '../../src/db/schema';

describe('conversation title ownership', () => {
  const email = `conversation-title-${randomUUID()}@chalk.local`;
  let userId: string;
  let conversationId: string;

  beforeAll(async () => {
    const db = getDb();
    const user = (await db.insert(authUsers).values({
      email,
      passwordHash: await hash(`title-${randomUUID()}`, 4),
    }).returning())[0]!;
    userId = user.id;
    const conversation = (await db.insert(conversations).values({
      userId,
      sessionId: `title-session-${randomUUID()}`,
      sessionFilePath: `/tmp/title-${randomUUID()}.jsonl`,
    }).returning())[0]!;
    conversationId = conversation.id;
  });

  afterAll(async () => {
    if (userId) await getDb().delete(authUsers).where(eq(authUsers.id, userId));
    await closeDb();
  });

  it('keeps a manual title when a pending automatic title completes later', async () => {
    const titles = createConversationsDal(getDb());

    const fallback = await titles.initializeFallbackTitle(
      userId,
      conversationId,
      '这道三角形题为什么要作辅助线',
    );
    expect(fallback).toMatchObject({
      title: '这道三角形题为什么要作辅助线',
      titleSource: 'fallback',
    });

    await titles.update(userId, conversationId, {
      title: '三角形辅助线的作用',
      titleSource: 'manual',
    });

    await expect(
      titles.updateAutoTitle(userId, conversationId, '三角形辅助线思路'),
    ).resolves.toBeNull();

    await expect(titles.getById(userId, conversationId)).resolves.toMatchObject({
      title: '三角形辅助线的作用',
      titleSource: 'manual',
    });
  });
});
