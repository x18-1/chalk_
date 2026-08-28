import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import {
  applyLiveChalkboardCommand,
  describeChalkboardState,
  emptyChalkboardState,
  type Action,
  type LiveChalkboardPresentationState,
} from '@chalk/chalkboard';

import { PROMPT_IDS, buildPrompt } from '../../../prompts';

export type DiscussionParticipant = {
  id: string;
  name: string;
  role: 'teacher' | 'assistant' | 'student';
  persona: string;
};

export type DiscussionTranscriptMessage = {
  sender: 'student' | 'agent' | 'system';
  content: string;
  agentId?: string;
  agentName?: string;
  agentRole?: string;
};

export type ClassroomDiscussionModel = {
  complete(userId: string, input: {
    purpose: 'director';
    system: string;
    user: string;
    signal?: AbortSignal;
  }): Promise<{ text: string; providerId: string; modelId: string }>;
  stream(userId: string, input: {
    purpose: 'participant';
    system: string;
    messages: DiscussionTranscriptMessage[];
    agent: DiscussionParticipant;
    signal?: AbortSignal;
  }): AsyncIterable<
    | { type: 'text_delta'; delta: string }
    | { type: 'action'; actionId: string; actionName: string; params: Record<string, unknown> }
    | { type: 'done'; providerId: string; modelId: string }
  >;
};

export type DiscussionGraphEvent =
  | { type: 'agent_started'; agent: DiscussionParticipant }
  | { type: 'text_delta'; delta: string }
  | { type: 'action'; action: Action; agent: DiscussionParticipant }
  | { type: 'agent_finished'; content: string; actions: Action[] }
  | { type: 'awaiting_student'; fromAgentId?: string };

type AgentResponse = {
  agentId: string;
  agentName: string;
  contentPreview: string;
  actionCount: number;
};

const DiscussionState = Annotation.Root({
  userId: Annotation<string>,
  participants: Annotation<DiscussionParticipant[]>,
  messages: Annotation<DiscussionTranscriptMessage[]>({
    reducer: (previous, update) => [...previous, ...update],
    default: () => [],
  }),
  topic: Annotation<string>,
  prompt: Annotation<string | null>,
  triggerAgentId: Annotation<string | null>,
  stateContext: Annotation<string>,
  liveChalkboard: Annotation<LiveChalkboardPresentationState>,
  model: Annotation<ClassroomDiscussionModel>,
  signal: Annotation<AbortSignal | undefined>,
  emit: Annotation<(event: DiscussionGraphEvent) => Promise<void>>,
  currentAgentId: Annotation<string | null>,
  turnCount: Annotation<number>,
  responses: Annotation<AgentResponse[]>({
    reducer: (previous, update) => [...previous, ...update],
    default: () => [],
  }),
  outcome: Annotation<'running' | 'awaiting_student' | 'completed'>,
  directorPromptRevision: Annotation<string | null>,
  participantPromptRevision: Annotation<string | null>,
  modelProviderId: Annotation<string | null>,
  modelId: Annotation<string | null>,
});

type DiscussionStateType = typeof DiscussionState.State;

const MAX_AGENT_TURNS = 3;

function conversationSummary(messages: readonly DiscussionTranscriptMessage[]) {
  return messages
    .slice(-12)
    .map((message) => message.sender === 'student'
      ? `[Student (Human)]: ${message.content}`
      : message.sender === 'agent'
        ? `[Agent] ${message.agentName ?? message.agentId ?? 'Classroom Agent'}: ${message.content}`
        : `[System]: ${message.content}`)
    .join('\n');
}

function participantList(participants: readonly DiscussionParticipant[]) {
  return participants
    .map((participant) => `- id: "${participant.id}", name: "${participant.name}", role: ${participant.role}, priority: ${participant.role === 'teacher' ? 10 : participant.role === 'assistant' ? 7 : 5}`)
    .join('\n');
}

function respondedList(responses: readonly AgentResponse[]) {
  return responses.length === 0
    ? 'None yet.'
    : responses
        .map((response) => `- ${response.agentName} (${response.agentId}): "${response.contentPreview}" [${response.actionCount} actions]`)
        .join('\n');
}

function parseDirectorDecision(text: string, allowedIds: ReadonlySet<string>) {
  try {
    const match = text.match(/\{[\s\S]*?"next_agent"[\s\S]*?\}/);
    if (!match) return { kind: 'end' as const };
    const value = (JSON.parse(match[0]) as { next_agent?: unknown }).next_agent;
    if (value === 'USER') return { kind: 'user' as const };
    if (value === 'END' || value === null || value === undefined) return { kind: 'end' as const };
    return typeof value === 'string' && allowedIds.has(value)
      ? { kind: 'agent' as const, agentId: value }
      : { kind: 'end' as const };
  } catch {
    return { kind: 'end' as const };
  }
}

function isPureAcknowledgment(message: DiscussionTranscriptMessage | undefined) {
  if (message?.sender !== 'student') return false;
  const normalized = message.content
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s。！!,.，~～～·…]+/gu, '');
  return /^(?:我)?(?:懂|懂了|明白|明白了|知道|知道了|了解|了解了|学会|学会了|清楚|清楚了|好|好的|行|谢谢|谢谢老师|gotit|i(?:understand|see)|understood|thanks|thankyou)$/u.test(normalized);
}

async function directorNode(state: DiscussionStateType): Promise<Partial<DiscussionStateType>> {
  state.signal?.throwIfAborted();
  const teacher = state.participants.find((participant) => participant.role === 'teacher')
    ?? state.participants[0];
  if (!teacher) return { outcome: 'completed', currentAgentId: null };

  if (state.turnCount === 0) {
    const firstSessionRound = !state.messages.some((message) => message.sender === 'agent');
    const studentInitiated = state.messages.at(-1)?.sender === 'student';
    if (!studentInitiated) {
      const trigger = firstSessionRound
        ? state.participants.find((participant) => participant.id === state.triggerAgentId)
        : undefined;
      return { currentAgentId: (trigger ?? teacher).id, outcome: 'running' };
    }
    if (isPureAcknowledgment(state.messages.at(-1))) {
      return { currentAgentId: null, outcome: 'completed' };
    }
  }
  if (state.turnCount >= MAX_AGENT_TURNS) {
    await state.emit({
      type: 'awaiting_student',
      ...(state.responses.at(-1)?.agentId ? { fromAgentId: state.responses.at(-1)!.agentId } : {}),
    });
    return { currentAgentId: null, outcome: 'awaiting_student' };
  }

  const prompt = buildPrompt(PROMPT_IDS.CLASSROOM_DISCUSSION_DIRECTOR, {
    agentList: participantList(state.participants),
    respondedList: respondedList(state.responses),
    conversationSummary: conversationSummary(state.messages),
    discussionSection: `\n# Discussion Mode\nTopic: "${state.topic}"${state.prompt ? `\nPrompt: "${state.prompt}"` : ''}\nThis is a student-initiated discussion, not a Q&A session.\n`,
    whiteboardSection: `\n# Live Chalkboard\n${describeChalkboardState(state.liveChalkboard)}\n`,
    studentProfileSection: '',
    rule1: state.turnCount === 0
      ? '1. First classify the latest human turn. If it is only an acknowledgment with no question, confusion, frustration, or new idea (for example "I understand"), output END. Otherwise route the unresolved turn to the teacher. After the teacher answers, other participants may add one distinct, useful perspective.'
      : '1. The teacher should address each unresolved human student turn before other participants add a distinct, useful perspective.',
    turnCountPlusOne: state.turnCount + 1,
    whiteboardOpenText: state.liveChalkboard.open ? 'OPEN' : 'CLOSED',
  });
  const result = await state.model.complete(state.userId, {
    purpose: 'director',
    system: prompt.system,
    user: 'Decide which agent should speak next.',
    signal: state.signal,
  });
  const decision = parseDirectorDecision(
    result.text,
    new Set(state.participants.map((participant) => participant.id)),
  );
  if (decision.kind === 'agent') {
    return {
      currentAgentId: decision.agentId,
      outcome: 'running',
      directorPromptRevision: prompt.revision,
      modelProviderId: result.providerId,
      modelId: result.modelId,
    };
  }
  if (decision.kind === 'user') {
    await state.emit({
      type: 'awaiting_student',
      ...(state.responses.at(-1)?.agentId ? { fromAgentId: state.responses.at(-1)!.agentId } : {}),
    });
    return {
      currentAgentId: null,
      outcome: 'awaiting_student',
      directorPromptRevision: prompt.revision,
      modelProviderId: result.providerId,
      modelId: result.modelId,
    };
  }
  return {
    currentAgentId: null,
    outcome: 'completed',
    directorPromptRevision: prompt.revision,
    modelProviderId: result.providerId,
    modelId: result.modelId,
  };
}

function roleGuideline(role: DiscussionParticipant['role']) {
  if (role === 'teacher') return 'teacher — lead with a direct, accurate explanation and invite the student to think';
  if (role === 'assistant') return 'teaching assistant — add one simpler analogy or missing detail without repeating the teacher';
  return 'student peer — contribute one concise question, observation, or alternative perspective';
}

function lengthGuideline(role: DiscussionParticipant['role']) {
  return role === 'teacher'
    ? 'Keep the response conversational and focused, usually 2–3 short sentences.'
    : 'Keep the response to 1–2 short sentences so the supporting role does not take over.';
}

async function participantNode(state: DiscussionStateType): Promise<Partial<DiscussionStateType>> {
  state.signal?.throwIfAborted();
  const participant = state.participants.find((candidate) => candidate.id === state.currentAgentId);
  if (!participant) return { currentAgentId: null, outcome: 'completed' };

  const peers = state.responses.length === 0
    ? ''
    : `Other participants already said:\n${state.responses.map((response) => `- ${response.agentName}: ${response.contentPreview}`).join('\n')}\nAdd a distinct perspective; do not repeat them.`;
  const prompt = buildPrompt(PROMPT_IDS.CLASSROOM_DISCUSSION_PARTICIPANT, {
    agentName: participant.name,
    persona: participant.persona,
    roleGuideline: roleGuideline(participant.role),
    peerContext: peers,
    languageConstraint: 'Respond in the same language as the human student.',
    stateContext: state.stateContext,
    chalkboardState: describeChalkboardState(state.liveChalkboard),
    discussionContextSection: `Topic: ${state.topic}${state.prompt ? `\nGuiding prompt: ${state.prompt}` : ''}`,
    lengthGuidelines: lengthGuideline(participant.role),
    chalkboardGuidelines: participant.role === 'student'
      ? 'Default to speech only. Use the Live Chalkboard only when the human or teacher explicitly invited you to show work on it.'
      : 'Use the Live Chalkboard for one concise visual when it materially helps the explanation. Do not redraw content already visible on the slide or Chalkboard.',
  });

  await state.emit({ type: 'agent_started', agent: participant });
  let content = '';
  let providerId = state.modelProviderId;
  let modelId = state.modelId;
  let liveChalkboard = state.liveChalkboard;
  const actions: Action[] = [];
  for await (const event of state.model.stream(state.userId, {
    purpose: 'participant',
    system: prompt.system,
    messages: state.messages,
    agent: participant,
    signal: state.signal,
  })) {
    state.signal?.throwIfAborted();
    if (event.type === 'text_delta') {
      content += event.delta;
      await state.emit({ type: 'text_delta', delta: event.delta });
    } else if (event.type === 'action') {
      if (actions.length >= 8) continue;
      const applied = applyLiveChalkboardCommand(liveChalkboard, {
        ...event.params,
        id: event.actionId,
        type: event.actionName,
      });
      if (!applied.ok) continue;
      liveChalkboard = applied.state;
      actions.push(applied.action);
      await state.emit({ type: 'action', action: applied.action, agent: participant });
    } else {
      providerId = event.providerId;
      modelId = event.modelId;
    }
  }
  const normalized = content.trim();
  if (!normalized) throw new Error(`Classroom discussion participant ${participant.id} returned no content`);
  await state.emit({ type: 'agent_finished', content: normalized, actions });
  return {
    messages: [{
      sender: 'agent',
      content: normalized,
      agentId: participant.id,
      agentName: participant.name,
      agentRole: participant.role,
    }],
    responses: [{
      agentId: participant.id,
      agentName: participant.name,
      contentPreview: normalized.slice(0, 300),
      actionCount: actions.length,
    }],
    liveChalkboard,
    turnCount: state.turnCount + 1,
    participantPromptRevision: prompt.revision,
    modelProviderId: providerId,
    modelId,
  };
}

function routeAfterDirector(state: DiscussionStateType) {
  return state.outcome === 'running' && state.currentAgentId ? 'participant' : END;
}

const discussionGraph = new StateGraph(DiscussionState)
  .addNode('director', directorNode)
  .addNode('participant', participantNode)
  .addEdge(START, 'director')
  .addConditionalEdges('director', routeAfterDirector)
  .addEdge('participant', 'director')
  .compile();

export async function runClassroomDiscussionGraph(input: {
  userId: string;
  participants: DiscussionParticipant[];
  messages: DiscussionTranscriptMessage[];
  topic: string;
  prompt?: string;
  triggerAgentId?: string;
  stateContext: string;
  liveChalkboard?: LiveChalkboardPresentationState;
  model: ClassroomDiscussionModel;
  signal?: AbortSignal;
  emit(event: DiscussionGraphEvent): Promise<void>;
}) {
  return discussionGraph.invoke({
    ...input,
    liveChalkboard: input.liveChalkboard ?? emptyChalkboardState(),
    prompt: input.prompt ?? null,
    triggerAgentId: input.triggerAgentId ?? null,
    currentAgentId: null,
    turnCount: 0,
    responses: [],
    outcome: 'running',
    directorPromptRevision: null,
    participantPromptRevision: null,
    modelProviderId: null,
    modelId: null,
  }, { recursionLimit: 10 });
}
