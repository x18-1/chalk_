import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hash } from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { encrypt } from '../../src/security/credential-encryption';
import {
  closeRuntime,
  createSession,
  getOrCreateRuntime,
} from '../../src/agent/runtime-manager';
import { buildApi } from '../../src/app';
import { loadConfig } from '../../src/config';
import { closeDb, getDb } from '../../src/db/client';
import { createCustomProvidersDal, createToolApprovalsDal } from '../../src/db/dal';
import { authUsers, conversations, toolApprovals } from '../../src/db/schema';

describe('tool approval persistence', () => {
  const email = `approval-${randomUUID()}@chalk.local`;
  const password = `approval-password-${randomUUID()}`;
  let userId: string;
  let conversationId: string;

  beforeAll(async () => {
    process.env.SESSIONS_ROOT ??= join(await mkdtemp(join(tmpdir(), 'chalk-approval-')), 'sessions');
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    const db = getDb();
    const user = (await db.insert(authUsers).values({
      email,
      passwordHash: await hash(password, 4),
    }).returning())[0]!;
    userId = user.id;
    const conversation = (await db.insert(conversations).values({
      userId,
      sessionId: `approval-session-${randomUUID()}`,
      sessionFilePath: `/tmp/approval-session-${randomUUID()}.jsonl`,
    }).returning())[0]!;
    conversationId = conversation.id;
    await createCustomProvidersDal(db).create(userId, {
      name: 'Approval fixture',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKeyEnc: encrypt('fixture-key'),
      modelIds: [{
        id: 'fixture-model',
        name: 'Fixture Model',
        reasoning: false,
        input: ['text'],
        contextWindow: 128_000,
        maxTokens: 8_192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }],
    });
  });

  afterAll(async () => {
    if (userId) {
      await getDb().delete(authUsers).where(eq(authUsers.id, userId));
    }
    await closeDb();
  });

  it('rejects only pending approvals whose deadline has elapsed', async () => {
    const db = getDb();
    const now = new Date();
    await db.insert(toolApprovals).values([
      {
        conversationId,
        toolCallId: 'expired-pending',
        toolName: 'sensitive_tool',
        args: {},
        status: 'pending',
        createdAt: new Date(now.getTime() - 121_000),
      },
      {
        conversationId,
        toolCallId: 'fresh-pending',
        toolName: 'sensitive_tool',
        args: {},
        status: 'pending',
        createdAt: new Date(now.getTime() - 30_000),
      },
      {
        conversationId,
        toolCallId: 'expired-approved',
        toolName: 'sensitive_tool',
        args: {},
        status: 'approved',
        createdAt: new Date(now.getTime() - 121_000),
        decidedAt: new Date(now.getTime() - 110_000),
      },
    ]);

    const recovered = await createToolApprovalsDal(db).rejectExpiredPending(
      new Date(now.getTime() - 120_000),
    );

    expect(recovered).toBe(1);
    const rows = await createToolApprovalsDal(db).listByConversation(userId, conversationId);
    expect(Object.fromEntries(rows.map((row) => [row.toolCallId, row.status]))).toEqual({
      'expired-pending': 'rejected',
      'fresh-pending': 'pending',
      'expired-approved': 'approved',
    });
  });

  it('allows exactly one decision for a pending tool call', async () => {
    const db = getDb();
    await db.insert(toolApprovals).values({
      conversationId,
      toolCallId: 'concurrent-decision',
      toolName: 'sensitive_tool',
      args: {},
    });

    const approvals = createToolApprovalsDal(db);
    const decisions = await Promise.allSettled([
      approvals.updateStatusByToolCall(
        userId,
        conversationId,
        'concurrent-decision',
        'approved',
      ),
      approvals.updateStatusByToolCall(
        userId,
        conversationId,
        'concurrent-decision',
        'rejected',
      ),
    ]);

    expect(decisions.filter((decision) => decision.status === 'fulfilled')).toHaveLength(1);
    expect(decisions.filter((decision) => decision.status === 'rejected')).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ name: 'ToolApprovalAlreadyDecidedError' }),
      }),
    ]);
  });

  it('allows exactly one decision when addressed by approval id', async () => {
    const approvals = createToolApprovalsDal(getDb());
    const approval = await approvals.create(userId, {
      conversationId,
      toolCallId: 'approval-id-decision',
      toolName: 'sensitive_tool',
      args: {},
    });

    await approvals.updateStatus(userId, approval.id, 'rejected');

    await expect(
      approvals.updateStatus(userId, approval.id, 'approved'),
    ).rejects.toMatchObject({ name: 'ToolApprovalAlreadyDecidedError' });
  });

  it('recovers expired pending approvals when the API process starts', async () => {
    const db = getDb();
    await db.insert(toolApprovals).values({
      conversationId,
      toolCallId: 'pending-before-restart',
      toolName: 'sensitive_tool',
      args: {},
      status: 'pending',
      createdAt: new Date('2026-08-12T00:00:00.000Z'),
    });

    const app = await buildApi({
      config: loadConfig({
        NODE_ENV: 'test',
        TOOL_APPROVAL_TIMEOUT_MS: '120000',
      }),
    });
    await app.close();

    const rows = await createToolApprovalsDal(db).listByConversation(userId, conversationId);
    expect(rows.find((row) => row.toolCallId === 'pending-before-restart')).toMatchObject({
      status: 'rejected',
      decidedAt: expect.any(Date),
    });
  });

  it('never approves a recovered call and hides it from another owner', async () => {
    const db = getDb();
    const foreignEmail = `approval-foreign-${randomUUID()}@chalk.local`;
    const foreignPassword = `approval-password-${randomUUID()}`;
    const foreign = (await db.insert(authUsers).values({
      email: foreignEmail,
      passwordHash: await hash(foreignPassword, 4),
    }).returning())[0]!;
    await db.insert(toolApprovals).values({
      conversationId,
      toolCallId: 'recovered-http-call',
      toolName: 'sensitive_tool',
      args: {},
      status: 'pending',
      createdAt: new Date('2026-08-12T00:00:00.000Z'),
    });

    const app = await buildApi({
      config: loadConfig({
        NODE_ENV: 'test',
        SESSION_COOKIE_NAME: 'approval_test_session',
        TOOL_APPROVAL_TIMEOUT_MS: '120000',
      }),
    });
    try {
      const ownerLogin = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password },
      });
      const foreignLogin = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: foreignEmail, password: foreignPassword },
      });
      const ownerCookie = responseCookie(ownerLogin.headers['set-cookie']);
      const foreignCookie = responseCookie(foreignLogin.headers['set-cookie']);

      const ownerDecision = await app.inject({
        method: 'POST',
        url: `/chat/${conversationId}/approve`,
        headers: { cookie: ownerCookie },
        payload: { toolCallId: 'recovered-http-call', approved: true },
      });
      expect(ownerDecision.statusCode).toBe(409);
      expect(ownerDecision.json()).toMatchObject({ code: 'NO_ACTIVE_RUN' });

      const foreignDecision = await app.inject({
        method: 'POST',
        url: `/chat/${conversationId}/approve`,
        headers: { cookie: foreignCookie },
        payload: { toolCallId: 'recovered-http-call', approved: true },
      });
      expect(foreignDecision.statusCode).toBe(404);
      expect(foreignDecision.json()).toMatchObject({ code: 'NOT_FOUND' });

      const rows = await createToolApprovalsDal(db).listByConversation(userId, conversationId);
      expect(rows.find((row) => row.toolCallId === 'recovered-http-call')?.status).toBe('rejected');
    } finally {
      await app.close();
      await db.delete(authUsers).where(eq(authUsers.id, foreign.id));
    }
  });

  async function createOwnedRuntimeConversation() {
    const session = await createSession(userId);
    return (await getDb().insert(conversations).values({
      userId,
      sessionId: session.descriptor.id,
      sessionFilePath: session.descriptor.path,
    }).returning())[0]!;
  }

  it('rejects leftover pending approvals when the runtime is recreated', async () => {
    const conversation = await createOwnedRuntimeConversation();
    const approvals = createToolApprovalsDal(getDb());
    await approvals.create(userId, {
      conversationId: conversation.id,
      toolCallId: 'pending-before-recreate',
      toolName: 'sensitive_tool',
      args: {},
    });

    await getOrCreateRuntime(userId, conversation);
    await closeRuntime(conversation.id);

    const rows = await approvals.listByConversation(userId, conversation.id);
    expect(rows.find((row) => row.toolCallId === 'pending-before-recreate')).toMatchObject({
      status: 'rejected',
      decidedAt: expect.any(Date),
    });
  });

  it('does not approve a leftover pending call after the runtime is recreated', async () => {
    const conversation = await createOwnedRuntimeConversation();
    const approvals = createToolApprovalsDal(getDb());
    await approvals.create(userId, {
      conversationId: conversation.id,
      toolCallId: 'stale-pending-approve',
      toolName: 'sensitive_tool',
      args: {},
    });

    await getOrCreateRuntime(userId, conversation);

    const app = await buildApi({
      config: loadConfig({
        NODE_ENV: 'test',
        SESSION_COOKIE_NAME: 'approval_stale_session',
      }),
    });
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email, password },
      });
      const decision = await app.inject({
        method: 'POST',
        url: `/chat/${conversation.id}/approve`,
        headers: { cookie: responseCookie(login.headers['set-cookie']) },
        payload: { toolCallId: 'stale-pending-approve', approved: true },
      });

      expect(decision.statusCode).toBe(409);
      expect(decision.json()).toMatchObject({ code: 'NO_ACTIVE_APPROVAL' });

      const rows = await approvals.listByConversation(userId, conversation.id);
      expect(rows.find((row) => row.toolCallId === 'stale-pending-approve')).toMatchObject({
        status: 'pending',
        decidedAt: null,
      });
    } finally {
      await app.close();
      await closeRuntime(conversation.id);
    }
  });

  it('times out approvals from the API config instead of process.env', async () => {
    const previousTimeout = process.env.TOOL_APPROVAL_TIMEOUT_MS;
    process.env.TOOL_APPROVAL_TIMEOUT_MS = '120000';
    const conversation = await createOwnedRuntimeConversation();
    const app = await buildApi({
      config: loadConfig({
        NODE_ENV: 'test',
        TOOL_APPROVAL_TIMEOUT_MS: '1000',
      }),
    });
    try {
      const entry = await getOrCreateRuntime(userId, conversation);
      const started = Date.now();
      const decision = await Promise.race([
        entry.approvals.request({
          toolCallId: 'config-timeout-call',
          toolName: 'sensitive_tool',
          label: 'Sensitive tool',
          args: {},
          context: {
            ownerId: userId,
            sessionId: conversation.sessionId,
            conversationId: conversation.id,
          },
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('approval used process.env timeout')), 3_000);
        }),
      ]);

      expect(Date.now() - started).toBeLessThan(3_000);
      expect(decision).toEqual({
        approved: false,
        reason: 'Tool approval timed out',
      });
    } finally {
      await app.close();
      await closeRuntime(conversation.id);
      if (previousTimeout === undefined) delete process.env.TOOL_APPROVAL_TIMEOUT_MS;
      else process.env.TOOL_APPROVAL_TIMEOUT_MS = previousTimeout;
    }
  });
});

function responseCookie(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.split(';', 1)[0] ?? '';
}
