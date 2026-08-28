import {
  applyLiveChalkboardCommand,
  CursorSnapshotSchema,
  projectScenePresentation,
  type Action,
} from '@chalk/chalkboard';
import { randomUUID } from 'node:crypto';

import type { Database } from '../../../db/client';
import {
  createClassroomDiscussionsDal,
  type DiscussionTarget,
} from '../../../db/dal';
import { ApiError } from '../../../http/errors';
import { PROMPT_IDS } from '../../../prompts';
import {
  runClassroomDiscussionGraph,
  type ClassroomDiscussionModel,
  type DiscussionGraphEvent,
  type DiscussionParticipant,
  type DiscussionTranscriptMessage,
} from './classroom-discussion.graph';

export type ClassroomDiscussionEvent =
  | { type: 'round_started'; roundId: string }
  | {
      type: 'agent_started';
      roundId: string;
      messageId: string;
      sequence: number;
      agentId: string;
      agentName: string;
      agentRole: DiscussionParticipant['role'];
    }
  | { type: 'text_delta'; roundId: string; messageId: string; sequence: number; delta: string }
  | {
      type: 'action';
      roundId: string;
      messageId: string;
      sequence: number;
      agentId: string;
      action: Action;
    }
  | { type: 'message_completed'; roundId: string; message: ReturnType<typeof projectMessage> }
  | { type: 'awaiting_student'; roundId: string; fromAgentId?: string }
  | { type: 'round_completed'; roundId: string; status: 'completed' | 'aborted' };

export type ClassroomDiscussionRun = {
  abort(): void;
  start(listener: (event: ClassroomDiscussionEvent) => void | Promise<void>): Promise<void>;
};

const DEFAULT_PARTICIPANTS: DiscussionParticipant[] = [
  {
    id: 'teacher',
    name: 'AI Teacher',
    role: 'teacher',
    persona: 'Warm, accurate, patient, and focused on helping the student understand the underlying method.',
  },
  {
    id: 'assistant',
    name: 'AI助教',
    role: 'assistant',
    persona: 'Friendly and practical. Uses one simple analogy or concrete example to fill a gap.',
  },
  {
    id: 'curious-student',
    name: '好奇同学',
    role: 'student',
    persona: 'Curious and concise. Notices one useful edge case or asks one natural follow-up question.',
  },
];

export class ClassroomDiscussionService {
  private readonly discussions;
  private readonly instanceId = randomUUID();
  private readonly activeRounds = new Map<string, AbortController>();

  constructor(
    db: Database,
    private readonly model: ClassroomDiscussionModel,
  ) {
    this.discussions = createClassroomDiscussionsDal(db);
  }

  recoverInterrupted() {
    return this.discussions.recoverInterrupted();
  }

  async createOrResume(userId: string, input: {
    target: DiscussionTarget;
    sceneId: string;
    topic: string;
    prompt?: string;
    triggerAgentId?: string;
    entryCursor?: unknown;
  }) {
    const context = await this.discussions.resolveTarget(userId, input.target, input.sceneId);
    const scene = sceneFromDocument(context.document, input.sceneId);
    if (!scene) {
      throw new ApiError(422, 'Discussion Scene does not belong to this classroom context', 'CLASSROOM_DISCUSSION_SCENE_INVALID');
    }
    const participants = participantsFromDocument(context.document);
    const entryCursor = input.target.kind === 'learning_session'
      ? CursorSnapshotSchema.parse(context.entryCursor)
      : validateDraftCursor(input.entryCursor, context.draftId!, input.sceneId);
    const result = await this.discussions.createOrResume(userId, {
      target: input.target,
      sceneId: input.sceneId,
      topic: input.topic,
      prompt: input.prompt,
      triggerAgentId: input.triggerAgentId,
      participants,
      entryCursor,
    });
    const discussion = await this.get(userId, result.row.id);
    return { discussion: discussion.discussion, created: result.created };
  }

  async getCurrent(userId: string, target: DiscussionTarget, sceneId: string) {
    await this.discussions.resolveTarget(userId, target, sceneId);
    const row = await this.discussions.findCurrent(userId, target, sceneId);
    if (!row) return { discussion: null };
    return this.get(userId, row.id);
  }

  async get(userId: string, discussionId: string) {
    const result = await this.discussions.get(userId, discussionId);
    return {
      discussion: {
        ...projectSession(result.session),
        messages: result.messages.map(projectMessage),
      },
    };
  }

  async createRound(userId: string, discussionId: string, input: { message?: string }) {
    const started = await this.discussions.startRound(userId, discussionId, this.instanceId, input.message);
    if (started.conflict) {
      throw new ApiError(409, 'A classroom discussion round is already running', 'CLASSROOM_DISCUSSION_ROUND_ACTIVE');
    }
    const controller = new AbortController();
    this.activeRounds.set(discussionId, controller);
    const { session, round } = started;
    const transcript = await this.discussions.get(userId, discussionId);
    const participants = parseParticipants(session.participants);
    const target: DiscussionTarget = session.learningSessionId
      ? { kind: 'learning_session', id: session.learningSessionId }
      : { kind: 'generation_run', id: session.generationRunId! };
    const classroomContext = await this.discussions.resolveTarget(userId, target, session.sceneId);
    const stateContext = classroomStateContext(
      classroomContext.document,
      session.sceneId,
      session.entryCursor,
    );
    const liveChalkboard = restoreLiveChalkboard(
      classroomContext.document,
      session.sceneId,
      session.entryCursor,
      transcript.messages.flatMap(messageActions),
    );

    return {
      abort: () => {
        void this.discussions.requestAbortRound(userId, discussionId).catch(() => undefined);
        controller.abort();
      },
      start: async (listener) => {
        let current: {
          id: string;
          sequence: number;
          content: string;
          actions: Action[];
          agentId: string;
          persistedLength: number;
        } | null = null;
        await listener({ type: 'round_started', roundId: round.id });

        const handleGraphEvent = async (event: DiscussionGraphEvent) => {
          if (event.type === 'agent_started') {
            const message = await this.discussions.startAgentMessage(userId, {
              discussionId,
              roundId: round.id,
              agentId: event.agent.id,
              agentName: event.agent.name,
              agentRole: event.agent.role,
            });
            current = {
              id: message.id,
              sequence: message.sequence,
              content: '',
              actions: [],
              agentId: event.agent.id,
              persistedLength: 0,
            };
            await listener({
              type: 'agent_started',
              roundId: round.id,
              messageId: message.id,
              sequence: message.sequence,
              agentId: event.agent.id,
              agentName: event.agent.name,
              agentRole: event.agent.role,
            });
            return;
          }
          if (event.type === 'text_delta') {
            if (!current) throw new Error('Discussion text arrived before an agent message started');
            current.content += event.delta;
            await listener({
              type: 'text_delta',
              roundId: round.id,
              messageId: current.id,
              sequence: current.sequence,
              delta: event.delta,
            });
            if (current.content.length - current.persistedLength >= 160) {
              await this.discussions.updateMessage(userId, {
                discussionId,
                messageId: current.id,
                content: current.content,
              });
              current.persistedLength = current.content.length;
            }
            return;
          }
          if (event.type === 'action') {
            if (!current) throw new Error('Discussion action arrived before an agent message started');
            current.actions.push(event.action);
            await this.discussions.updateMessage(userId, {
              discussionId,
              messageId: current.id,
              content: current.content,
              actions: current.actions,
            });
            await listener({
              type: 'action',
              roundId: round.id,
              messageId: current.id,
              sequence: current.sequence,
              agentId: current.agentId,
              action: event.action,
            });
            return;
          }
          if (event.type === 'agent_finished') {
            if (!current) throw new Error('Discussion agent finished before its message started');
            const completed = await this.discussions.updateMessage(userId, {
              discussionId,
              messageId: current.id,
              content: event.content,
              actions: event.actions,
              status: 'completed',
            });
            await listener({
              type: 'message_completed',
              roundId: round.id,
              message: projectMessage(completed),
            });
            current = null;
            return;
          }
          await listener({
            type: 'awaiting_student',
            roundId: round.id,
            ...(event.fromAgentId ? { fromAgentId: event.fromAgentId } : {}),
          });
        };

        const heartbeat = setInterval(() => {
          void this.discussions.heartbeatRound(userId, {
            discussionId,
            roundId: round.id,
            runnerId: this.instanceId,
          }).then((lease) => {
            if (!lease || lease.abortRequestedAt) controller.abort();
          }).catch(() => controller.abort());
        }, 1_000);
        heartbeat.unref();
        try {
          const graph = await runClassroomDiscussionGraph({
            userId,
            participants,
            messages: transcript.messages.map(toGraphMessage),
            topic: session.topic,
            ...(session.prompt ? { prompt: session.prompt } : {}),
            ...(session.triggerAgentId ? { triggerAgentId: session.triggerAgentId } : {}),
            stateContext,
            liveChalkboard,
            model: this.model,
            signal: controller.signal,
            emit: handleGraphEvent,
          });
          await this.discussions.finishRound(userId, {
            discussionId,
            roundId: round.id,
            status: 'completed',
            directorPromptId: PROMPT_IDS.CLASSROOM_DISCUSSION_DIRECTOR,
            directorPromptRevision: graph.directorPromptRevision ?? undefined,
            participantPromptId: PROMPT_IDS.CLASSROOM_DISCUSSION_PARTICIPANT,
            participantPromptRevision: graph.participantPromptRevision ?? undefined,
            modelProviderId: graph.modelProviderId ?? undefined,
            modelId: graph.modelId ?? undefined,
            runnerId: this.instanceId,
          });
          await listener({ type: 'round_completed', roundId: round.id, status: 'completed' });
        } catch (error) {
          const interrupted = current as {
            id: string;
            sequence: number;
            content: string;
            actions: Action[];
            agentId: string;
            persistedLength: number;
          } | null;
          if (interrupted) {
            await this.discussions.updateMessage(userId, {
              discussionId,
              messageId: interrupted.id,
              content: interrupted.content,
              actions: interrupted.actions,
              status: 'interrupted',
            }).catch(() => undefined);
          }
          const aborted = controller.signal.aborted || isAbortError(error);
          await this.discussions.finishRound(userId, {
            discussionId,
            roundId: round.id,
            status: aborted ? 'aborted' : 'failed',
            directorPromptId: PROMPT_IDS.CLASSROOM_DISCUSSION_DIRECTOR,
            participantPromptId: PROMPT_IDS.CLASSROOM_DISCUSSION_PARTICIPANT,
            errorCode: aborted ? 'ABORTED' : 'CLASSROOM_DISCUSSION_FAILED',
            runnerId: this.instanceId,
          }).catch(() => undefined);
          if (aborted) {
            await listener({ type: 'round_completed', roundId: round.id, status: 'aborted' });
            return;
          }
          throw error;
        } finally {
          clearInterval(heartbeat);
          if (this.activeRounds.get(discussionId) === controller) {
            this.activeRounds.delete(discussionId);
          }
        }
      },
    } satisfies ClassroomDiscussionRun;
  }

  async abortRound(userId: string, discussionId: string) {
    const requested = await this.discussions.requestAbortRound(userId, discussionId);
    if (!requested) {
      throw new ApiError(409, 'No classroom discussion round is running', 'CLASSROOM_DISCUSSION_ROUND_NOT_ACTIVE');
    }
    const controller = this.activeRounds.get(discussionId);
    controller?.abort();
  }

  async complete(userId: string, discussionId: string) {
    const result = await this.discussions.completeSession(userId, discussionId);
    if (result.conflict) {
      throw new ApiError(409, 'Stop the active discussion round before completing the session', 'CLASSROOM_DISCUSSION_ROUND_ACTIVE');
    }
    const completed = await this.get(userId, discussionId);
    return { discussion: completed.discussion, entryCursor: result.row.entryCursor };
  }
}

function sceneFromDocument(document: unknown, sceneId: string) {
  if (typeof document !== 'object' || document === null || !('scenes' in document) || !Array.isArray(document.scenes)) {
    return null;
  }
  return document.scenes.find((scene) => typeof scene === 'object' && scene !== null &&
    'id' in scene && scene.id === sceneId) ?? null;
}

function classroomStateContext(document: unknown, sceneId: string, cursorValue: unknown) {
  const documentRecord = asRecord(document);
  const stage = asRecord(documentRecord?.stage);
  const scene = asRecord(sceneFromDocument(document, sceneId));
  const actions = Array.isArray(scene?.actions) ? scene.actions : [];
  const cursor = CursorSnapshotSchema.safeParse(cursorValue);
  const actionIndex = cursor.success ? cursor.data.actionIndex : 0;
  const availableActions = actions.slice(0, Math.min(actions.length, actionIndex + 1));
  const classroomName = typeof stage?.name === 'string' ? stage.name : 'Untitled classroom';
  const sceneTitle = typeof scene?.title === 'string' ? scene.title : sceneId;
  const sceneType = typeof scene?.type === 'string' ? scene.type : 'unknown';

  return [
    `Classroom: ${classroomName}`,
    `Scene: ${sceneTitle} (${sceneType})`,
    `Cursor: action ${Math.min(actionIndex + 1, Math.max(actions.length, 1))} of ${Math.max(actions.length, 1)}`,
    `Visible scene content:\n${boundedJson(scene?.content)}`,
    `Teaching actions reached at this position:\n${boundedJson(availableActions)}`,
  ].join('\n');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
}

function boundedJson(value: unknown) {
  const serialized = JSON.stringify(value ?? null, null, 2);
  const limit = 12_000;
  return serialized.length <= limit ? serialized : `${serialized.slice(0, limit)}\n[truncated]`;
}

function messageActions(row: typeof import('../../../db/schema').classroomDiscussionMessages.$inferSelect): Action[] {
  return Array.isArray(row.actions)
    ? row.actions.filter((action): action is Action => typeof action === 'object' && action !== null &&
      'id' in action && typeof action.id === 'string' && 'type' in action && typeof action.type === 'string')
    : [];
}

function restoreLiveChalkboard(
  document: unknown,
  sceneId: string,
  cursorValue: unknown,
  discussionActions: readonly Action[],
) {
  const scene = asRecord(sceneFromDocument(document, sceneId));
  const sceneActions = Array.isArray(scene?.actions) ? scene.actions as Action[] : [];
  const cursor = CursorSnapshotSchema.safeParse(cursorValue);
  const actionIndex = cursor.success ? cursor.data.actionIndex : 0;
  let state = projectScenePresentation(sceneActions, actionIndex).liveChalkboard;
  for (const action of discussionActions) {
    const applied = applyLiveChalkboardCommand(state, action);
    if (applied.ok) state = applied.state;
  }
  return state;
}

function participantsFromDocument(document: unknown): DiscussionParticipant[] {
  if (typeof document !== 'object' || document === null || !('stage' in document) ||
    typeof document.stage !== 'object' || document.stage === null ||
    !('agentProfiles' in document.stage) || !Array.isArray(document.stage.agentProfiles)) {
    return DEFAULT_PARTICIPANTS;
  }
  const ids = new Set<string>();
  const participants = document.stage.agentProfiles.flatMap((raw): DiscussionParticipant[] => {
    if (typeof raw !== 'object' || raw === null) return [];
    const candidate = raw as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || !candidate.id.trim() || ids.has(candidate.id)) return [];
    ids.add(candidate.id);
    const role: DiscussionParticipant['role'] = candidate.role === 'teacher'
      ? 'teacher'
      : candidate.role === 'assistant' ? 'assistant' : 'student';
    return [{
      id: candidate.id,
      name: typeof candidate.name === 'string' && candidate.name.trim() ? candidate.name : candidate.id,
      role,
      persona: typeof candidate.persona === 'string' ? candidate.persona : '',
    }];
  }).slice(0, 8);
  if (participants.length === 0) return DEFAULT_PARTICIPANTS;
  if (!participants.some((participant) => participant.role === 'teacher')) {
    return [DEFAULT_PARTICIPANTS[0]!, ...participants].slice(0, 8);
  }
  return participants;
}

function parseParticipants(value: unknown): DiscussionParticipant[] {
  if (!Array.isArray(value)) return DEFAULT_PARTICIPANTS;
  const parsed = value.filter((participant): participant is DiscussionParticipant =>
    typeof participant === 'object' && participant !== null &&
    'id' in participant && typeof participant.id === 'string' &&
    'name' in participant && typeof participant.name === 'string' &&
    'role' in participant && ['teacher', 'assistant', 'student'].includes(String(participant.role)) &&
    'persona' in participant && typeof participant.persona === 'string');
  return parsed.length > 0 ? parsed : DEFAULT_PARTICIPANTS;
}

function validateDraftCursor(value: unknown, draftId: string, sceneId: string) {
  const cursor = CursorSnapshotSchema.parse(value);
  if (cursor.stageId !== draftId || cursor.sceneId !== sceneId || cursor.completed) {
    throw new ApiError(422, 'Draft discussion cursor does not belong to the completed Scene', 'CLASSROOM_DISCUSSION_CURSOR_INVALID');
  }
  return cursor;
}

function toGraphMessage(row: typeof import('../../../db/schema').classroomDiscussionMessages.$inferSelect): DiscussionTranscriptMessage {
  return {
    sender: row.sender as DiscussionTranscriptMessage['sender'],
    content: row.content,
    ...(row.agentId ? { agentId: row.agentId } : {}),
    ...(row.agentName ? { agentName: row.agentName } : {}),
    ...(row.agentRole ? { agentRole: row.agentRole } : {}),
  };
}

function projectSession(row: typeof import('../../../db/schema').classroomDiscussionSessions.$inferSelect) {
  return {
    id: row.id,
    status: row.status,
    sceneId: row.sceneId,
    topic: row.topic,
    prompt: row.prompt,
    triggerAgentId: row.triggerAgentId,
    target: row.learningSessionId
      ? { kind: 'learning_session' as const, id: row.learningSessionId }
      : { kind: 'generation_run' as const, id: row.generationRunId! },
    participants: parseParticipants(row.participants),
    entryCursor: row.entryCursor,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  };
}

function projectMessage(row: typeof import('../../../db/schema').classroomDiscussionMessages.$inferSelect) {
  return {
    id: row.id,
    roundId: row.roundId,
    sequence: row.sequence,
    sender: row.sender,
    agentId: row.agentId,
    agentName: row.agentName,
    agentRole: row.agentRole,
    content: row.content,
    actions: messageActions(row),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || error.message.includes('aborted'));
}
