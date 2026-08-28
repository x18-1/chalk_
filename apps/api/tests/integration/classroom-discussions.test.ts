import { randomUUID } from 'node:crypto';

import { hash } from 'bcryptjs';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApi } from '../../src/app';
import { loadConfig } from '../../src/config';
import { closeDb, getDb } from '../../src/db/client';
import { createClassroomDiscussionsDal } from '../../src/db/dal';
import {
  authUsers,
  classroomDiscussionMessages,
  classroomDiscussionRounds,
  classroomDrafts,
  classroomDraftScenes,
  classroomGenerationRuns,
} from '../../src/db/schema';

describe('Classroom Discussion HTTP/SSE boundary', () => {
  const suffix = randomUUID();
  const password = `password-${suffix}`;
  const users = [
    { email: `discussion-user-${suffix}@chalk.local`, role: 'user' as const, name: '讨论学生' },
    { email: `discussion-admin-${suffix}@chalk.local`, role: 'admin' as const, name: '其他学生' },
  ];
  const cookies = new Map<'user' | 'admin', string>();
  const userIds: string[] = [];
  const userIdByRole = new Map<'user' | 'admin', string>();
  let app: Awaited<ReturnType<typeof buildApi>>;
  let formalDiscussionId: string | null = null;
  let draftDiscussionId: string | null = null;
  const participantPrompts: string[] = [];
  let signalBlockingStreamStarted!: () => void;
  const blockingStreamStarted = new Promise<void>((resolve) => {
    signalBlockingStreamStarted = resolve;
  });

  const discussionModel = {
    async complete(
      _userId: string,
      input: { purpose: 'director'; system: string; user: string; signal?: AbortSignal },
    ) {
      input.signal?.throwIfAborted();
      const decision = input.system.includes('- 小助教 (assistant):')
        ? 'END'
        : input.system.includes('- 林老师 (teacher):')
          ? 'assistant'
          : input.system.includes('[Student (Human)]')
            ? 'teacher'
            : 'END';
      return {
        text: `{"next_agent":"${decision}"}`,
        providerId: 'fixture-provider',
        modelId: 'fixture-director-model',
      };
    },
    async *stream(
      _userId: string,
      input: {
        purpose: 'participant';
        system: string;
        messages: Array<{ sender: string; content: string }>;
        agent: { id: string; name: string };
        signal?: AbortSignal;
      },
    ) {
      participantPrompts.push(input.system);
      const text = input.agent.id === 'teacher'
        ? '先抓住等式两边必须保持平衡。'
        : '也可以把等式想成一架天平。';
      const shouldBlock = input.messages.some((message) =>
        message.sender === 'student' && message.content === '请停止这一轮');
      if (shouldBlock) {
        input.signal?.throwIfAborted();
        yield { type: 'text_delta' as const, delta: text.slice(0, 8) };
        signalBlockingStreamStarted();
        await new Promise<void>((resolve) => {
          if (input.signal?.aborted || !input.signal) resolve();
          else input.signal.addEventListener('abort', () => resolve(), { once: true });
        });
        input.signal?.throwIfAborted();
        return;
      }
      if (input.agent.id === 'teacher') {
        yield { type: 'action' as const, actionId: 'open-balance-board', actionName: 'wb_open', params: {} };
        yield {
          type: 'action' as const,
          actionId: 'draw-balance-equation',
          actionName: 'wb_draw_latex',
          params: { elementId: 'balance-equation', latex: 'x + 3 = 7', x: 100, y: 80 },
        };
      }
      for (const delta of [text.slice(0, 8), text.slice(8)]) {
        input.signal?.throwIfAborted();
        yield { type: 'text_delta' as const, delta };
      }
      yield {
        type: 'done' as const,
        providerId: 'fixture-provider',
        modelId: 'fixture-participant-model',
      };
    },
  };

  function responseCookie(value: string | string[] | undefined) {
    const first = Array.isArray(value) ? value[0] : value;
    return first?.split(';', 1)[0] ?? '';
  }

  function classroomDocument(stageId: string) {
    return {
      stage: {
        id: stageId,
        name: '一元一次方程',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        agentProfiles: [
          { id: 'teacher', name: '林老师', role: 'teacher', persona: '耐心引导学生。' },
          { id: 'assistant', name: '小助教', role: 'assistant', persona: '用生活类比补充。' },
          { id: 'curious', name: '好奇同学', role: 'student', persona: '提出简短追问。' },
        ],
      },
      scenes: [{
        id: `${stageId}-scene-1`,
        stageId,
        type: 'slide',
        title: '等式像天平',
        order: 0,
        content: {
          type: 'slide',
          canvas: {
            elements: [{ id: 'balance-rule', type: 'text', text: '等式两边同时减去 3，平衡保持不变。' }],
          },
        },
        actions: [{ id: 'discussion-1', type: 'discussion', topic: '为什么移项要变号？' }],
      }],
    };
  }

  function parseSse(body: string) {
    return body.split('\n\n').flatMap((frame) => {
      const type = frame.match(/^event: ([^\n]+)$/m)?.[1];
      const data = frame.match(/^data: (.+)$/m)?.[1];
      return type && data
        ? [{ type, data: JSON.parse(data) as Record<string, unknown> }]
        : [];
    });
  }

  beforeAll(async () => {
    const insertedUsers = await getDb()
      .insert(authUsers)
      .values(await Promise.all(users.map(async (user) => ({
        ...user,
        passwordHash: await hash(password, 4),
      }))))
      .returning({ id: authUsers.id, role: authUsers.role });
    userIds.push(...insertedUsers.map((user) => user.id));
    for (const user of insertedUsers) userIdByRole.set(user.role as 'user' | 'admin', user.id);

    app = await buildApi({
      config: loadConfig({
        NODE_ENV: 'test',
        SESSION_COOKIE_NAME: `discussion_${suffix}`,
        SESSION_COOKIE_SECURE: 'false',
      }),
      classroomDiscussionModel: discussionModel,
    });

    for (const user of users) {
      const login = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: user.email, password },
      });
      expect(login.statusCode).toBe(200);
      cookies.set(user.role, responseCookie(login.headers['set-cookie']));
    }
  });

  afterAll(async () => {
    await app?.close();
    if (userIds.length > 0) await getDb().delete(authUsers).where(inArray(authUsers.id, userIds));
    await closeDb();
  });

  it('creates an owned artifact discussion, streams a multi-agent round, and restores its transcript', async () => {
    const createdClassroom = await app.inject({
      method: 'POST',
      url: '/classrooms',
      headers: { cookie: cookies.get('user') },
      payload: { title: '一元一次方程', document: classroomDocument('discussion-stage') },
    });
    expect(createdClassroom.statusCode).toBe(201);
    const classroom = createdClassroom.json().classroom as {
      id: string;
      latestArtifact: { id: string };
    };
    const learning = await app.inject({
      method: 'POST',
      url: `/classrooms/${classroom.id}/artifacts/${classroom.latestArtifact.id}/learning-session`,
      headers: { cookie: cookies.get('user') },
    });
    expect(learning.statusCode).toBe(201);
    const learningSessionId = learning.json().learningSession.id as string;

    const target = {
      kind: 'learning_session',
      id: learningSessionId,
      sceneId: 'discussion-stage-scene-1',
      topic: '为什么移项要变号？',
    };
    const [anonymous, otherOwner] = await Promise.all([
      app.inject({ method: 'POST', url: '/classroom-discussions', payload: target }),
      app.inject({
        method: 'POST',
        url: '/classroom-discussions',
        headers: { cookie: cookies.get('admin') },
        payload: target,
      }),
    ]);
    expect(anonymous.statusCode).toBe(401);
    expect(otherOwner.statusCode).toBe(404);

    const created = await app.inject({
      method: 'POST',
      url: '/classroom-discussions',
      headers: { cookie: cookies.get('user') },
      payload: target,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      created: true,
      discussion: {
        status: 'active',
        sceneId: target.sceneId,
        topic: target.topic,
        target: { kind: 'learning_session', id: learningSessionId },
        participants: [
          { id: 'teacher', name: '林老师', role: 'teacher' },
          { id: 'assistant', name: '小助教', role: 'assistant' },
          { id: 'curious', name: '好奇同学', role: 'student' },
        ],
        messages: [],
      },
    });
    const discussionId = created.json().discussion.id as string;
    formalDiscussionId = discussionId;

    const streamed = await app.inject({
      method: 'POST',
      url: `/classroom-discussions/${discussionId}/rounds/stream`,
      headers: { cookie: cookies.get('user'), accept: 'text/event-stream' },
      payload: { message: '我还是不懂，能用天平解释吗？' },
    });
    expect(streamed.statusCode).toBe(200);
    expect(streamed.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    const events = parseSse(streamed.body);
    expect(events.map((event) => event.type), streamed.body).toEqual([
      'round_started',
      'agent_started',
      'action',
      'action',
      'text_delta',
      'text_delta',
      'message_completed',
      'agent_started',
      'text_delta',
      'text_delta',
      'message_completed',
      'round_completed',
    ]);
    expect(events.filter((event) => event.type === 'agent_started').map((event) => event.data.agentId))
      .toEqual(['teacher', 'assistant']);
    expect(participantPrompts).toEqual(expect.arrayContaining([
      expect.stringContaining('等式两边同时减去 3，平衡保持不变。'),
      expect.stringContaining('Teaching actions reached at this position'),
      expect.stringContaining('x + 3 = 7'),
    ]));

    const restored = await app.inject({
      method: 'GET',
      url: `/classroom-discussions/${discussionId}`,
      headers: { cookie: cookies.get('user') },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().discussion.messages).toMatchObject([
      { sequence: 1, sender: 'student', content: '我还是不懂，能用天平解释吗？', status: 'completed' },
      {
        sequence: 2,
        sender: 'agent',
        agentId: 'teacher',
        content: '先抓住等式两边必须保持平衡。',
        status: 'completed',
        actions: [
          { type: 'wb_open' },
          { type: 'wb_draw_latex', elementId: 'balance-equation', latex: 'x + 3 = 7' },
        ],
      },
      { sequence: 3, sender: 'agent', agentId: 'assistant', content: '也可以把等式想成一架天平。', status: 'completed' },
    ]);

    const resumed = await app.inject({
      method: 'POST',
      url: '/classroom-discussions',
      headers: { cookie: cookies.get('user') },
      payload: target,
    });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json()).toMatchObject({ created: false, discussion: { id: discussionId } });
  });

  it('aborts an active round and preserves its visible partial response', async () => {
    expect(formalDiscussionId).not.toBeNull();
    const streamPromise = app.inject({
      method: 'POST',
      url: `/classroom-discussions/${formalDiscussionId!}/rounds/stream`,
      headers: { cookie: cookies.get('user'), accept: 'text/event-stream' },
      payload: { message: '请停止这一轮' },
    });

    await blockingStreamStarted;
    const aborted = await app.inject({
      method: 'POST',
      url: `/classroom-discussions/${formalDiscussionId!}/abort`,
      headers: { cookie: cookies.get('user') },
    });
    expect(aborted.statusCode).toBe(200);

    const streamed = await streamPromise;
    expect(parseSse(streamed.body).map((event) => event.type)).toEqual([
      'round_started',
      'agent_started',
      'text_delta',
      'round_completed',
    ]);
    expect(parseSse(streamed.body).at(-1)?.data).toMatchObject({ status: 'aborted' });

    const restored = await app.inject({
      method: 'GET',
      url: `/classroom-discussions/${formalDiscussionId!}`,
      headers: { cookie: cookies.get('user') },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().discussion.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ sender: 'student', content: '请停止这一轮', status: 'completed' }),
      expect.objectContaining({ sender: 'agent', content: '先抓住等式两边必', status: 'interrupted' }),
    ]));

    const completed = await app.inject({
      method: 'POST',
      url: `/classroom-discussions/${formalDiscussionId!}/complete`,
      headers: { cookie: cookies.get('user') },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({
      discussion: { status: 'completed', messages: restored.json().discussion.messages },
      entryCursor: { sceneId: 'discussion-stage-scene-1' },
    });

    const current = await app.inject({
      method: 'GET',
      url: `/classroom-discussions/current?kind=learning_session&id=${completed.json().discussion.target.id}&sceneId=discussion-stage-scene-1`,
      headers: { cookie: cookies.get('user') },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json()).toEqual({ discussion: null });
  });

  it('binds a draft discussion to one owned completed Scene Generation Run', async () => {
    const userId = userIdByRole.get('user')!;
    const [draft] = await getDb().insert(classroomDrafts).values({
      userId,
      requirements: '讲清楚等式的性质',
      context: {},
      status: 'generating',
    }).returning();
    const [run] = await getDb().insert(classroomGenerationRuns).values({
      userId,
      draftId: draft!.id,
      stage: 'scenes',
      status: 'running',
    }).returning();
    await getDb().insert(classroomDraftScenes).values({
      userId,
      draftId: draft!.id,
      outlineId: 'draft-scene-1',
      type: 'slide',
      order: 0,
      outline: { id: 'draft-scene-1', type: 'slide', title: '等式性质', order: 0 },
      content: { type: 'slide', canvas: { elements: [] } },
      actions: [],
      status: 'completed',
      actionStatus: 'completed',
    });

    const payload = {
      kind: 'generation_run',
      id: run!.id,
      sceneId: 'draft-scene-1',
      topic: '草稿课堂追问',
      triggerAgentId: 'assistant',
      entryCursor: {
        version: 1,
        stageId: draft!.id,
        sceneId: 'draft-scene-1',
        sceneIndex: 0,
        actionIndex: 0,
        mode: 'paused',
        completed: false,
      },
    };
    const created = await app.inject({
      method: 'POST',
      url: '/classroom-discussions',
      headers: { cookie: cookies.get('user') },
      payload,
    });
    expect(created.statusCode).toBe(201);
    draftDiscussionId = created.json().discussion.id as string;
    expect(created.json().discussion).toMatchObject({
      sceneId: 'draft-scene-1',
      target: { kind: 'generation_run', id: run!.id },
      entryCursor: payload.entryCursor,
    });

    const current = await app.inject({
      method: 'GET',
      url: `/classroom-discussions/current?kind=generation_run&id=${run!.id}&sceneId=draft-scene-1`,
      headers: { cookie: cookies.get('user') },
    });
    expect(current.statusCode).toBe(200);
    expect(current.json().discussion.id).toBe(created.json().discussion.id);

    const authoredRound = await app.inject({
      method: 'POST',
      url: `/classroom-discussions/${created.json().discussion.id}/rounds/stream`,
      headers: { cookie: cookies.get('user'), accept: 'text/event-stream' },
      payload: {},
    });
    expect(authoredRound.statusCode).toBe(200);
    expect(parseSse(authoredRound.body).find((event) => event.type === 'agent_started')?.data)
      .toMatchObject({ agentId: 'assistant' });
  });

  it('keeps fresh rounds intact and recovers only stale persisted work', async () => {
    expect(draftDiscussionId).not.toBeNull();
    const userId = userIdByRole.get('user')!;
    const [round] = await getDb().insert(classroomDiscussionRounds).values({
      discussionId: draftDiscussionId!,
      userId,
      status: 'running',
      leaseOwner: 'owner-api-instance',
    }).returning();
    await getDb().insert(classroomDiscussionMessages).values({
      discussionId: draftDiscussionId!,
      roundId: round!.id,
      userId,
      sequence: 999,
      sender: 'agent',
      agentId: 'teacher',
      agentName: 'AI Teacher',
      agentRole: 'teacher',
      content: '进程中断前已经显示的部分',
      status: 'streaming',
    });

    const dal = createClassroomDiscussionsDal(getDb());
    const completionWhileRunning = await dal.completeSession(userId, draftDiscussionId!);
    expect(completionWhileRunning).toEqual({ conflict: true });
    const requested = await dal.requestAbortRound(userId, draftDiscussionId!);
    expect(requested).toMatchObject({ id: round!.id, abortRequestedAt: expect.any(Date) });
    const lease = await dal.heartbeatRound(userId, {
      discussionId: draftDiscussionId!,
      roundId: round!.id,
      runnerId: 'other-api-instance',
    });
    expect(lease).toBeNull();
    const ownerLease = await dal.heartbeatRound(userId, {
      discussionId: draftDiscussionId!,
      roundId: round!.id,
      runnerId: 'owner-api-instance',
    });
    expect(ownerLease).toMatchObject({ abortRequestedAt: expect.any(Date) });
    await dal.recoverInterrupted();
    const [freshRound] = await getDb().select().from(classroomDiscussionRounds)
      .where(eq(classroomDiscussionRounds.id, round!.id));
    expect(freshRound?.status).toBe('running');

    await dal.recoverInterrupted(new Date(Date.now() + 1_000));
    const [recoveredRound] = await getDb().select().from(classroomDiscussionRounds)
      .where(eq(classroomDiscussionRounds.id, round!.id));
    const [recoveredMessage] = await getDb().select().from(classroomDiscussionMessages)
      .where(eq(classroomDiscussionMessages.roundId, round!.id));
    expect(recoveredRound).toMatchObject({ status: 'aborted', errorCode: 'PROCESS_INTERRUPTED' });
    expect(recoveredMessage).toMatchObject({
      content: '进程中断前已经显示的部分',
      status: 'interrupted',
    });
  });
});
