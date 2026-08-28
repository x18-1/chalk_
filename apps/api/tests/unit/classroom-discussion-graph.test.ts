import { describe, expect, it } from 'vitest';

import {
  runClassroomDiscussionGraph,
  type ClassroomDiscussionModel,
  type DiscussionParticipant,
} from '../../src/modules/classroom-discussions/services/classroom-discussion.graph';

const participants: DiscussionParticipant[] = [
  { id: 'teacher', name: '林老师', role: 'teacher', persona: '负责主讲。' },
  { id: 'assistant', name: '小助教', role: 'assistant', persona: '负责补充类比。' },
];

function fixtureModel(spokenBy: string[]): ClassroomDiscussionModel {
  return {
    async complete() {
      return { text: '{"next_agent":"END"}', providerId: 'fixture', modelId: 'director' };
    },
    async *stream(_userId, input) {
      spokenBy.push(input.agent.id);
      yield { type: 'text_delta' as const, delta: `${input.agent.name}先说。` };
      yield { type: 'done' as const, providerId: 'fixture', modelId: 'participant' };
    },
  };
}

describe('classroom discussion graph', () => {
  it('uses the authored trigger Agent for the first Session round', async () => {
    const spokenBy: string[] = [];
    await runClassroomDiscussionGraph({
      userId: 'user-1',
      participants,
      messages: [],
      topic: '请小助教先举例',
      triggerAgentId: 'assistant',
      stateContext: 'Scene: 等式像天平',
      model: fixtureModel(spokenBy),
      emit: async () => undefined,
    });
    expect(spokenBy).toEqual(['assistant']);
  });

  it('fails closed to the teacher when a trigger Agent is not in the classroom', async () => {
    const spokenBy: string[] = [];
    await runClassroomDiscussionGraph({
      userId: 'user-1',
      participants,
      messages: [],
      topic: '非法角色不能发言',
      triggerAgentId: 'untrusted-agent',
      stateContext: 'Scene: 等式像天平',
      model: fixtureModel(spokenBy),
      emit: async () => undefined,
    });
    expect(spokenBy).toEqual(['teacher']);
  });

  it('lets the Director route a later unresolved student question to the teacher', async () => {
    const spokenBy: string[] = [];
    const model = fixtureModel(spokenBy);
    let directorCalls = 0;
    model.complete = async () => ({
      text: directorCalls++ === 0 ? '{"next_agent":"teacher"}' : '{"next_agent":"END"}',
      providerId: 'fixture',
      modelId: 'director',
    });
    await runClassroomDiscussionGraph({
      userId: 'user-1',
      participants,
      messages: [
        { sender: 'agent', agentId: 'assistant', agentName: '小助教', content: '第一次讨论。' },
        { sender: 'student', content: '我还有一个问题。' },
      ],
      topic: '继续追问',
      triggerAgentId: 'assistant',
      stateContext: 'Scene: 等式像天平',
      model,
      emit: async () => undefined,
    });
    expect(spokenBy).toEqual(['teacher']);
  });

  it('does not force an Agent reply after a student acknowledgment', async () => {
    const spokenBy: string[] = [];
    const model = fixtureModel(spokenBy);
    let directorCalls = 0;
    model.complete = async () => {
      directorCalls += 1;
      return { text: '{"next_agent":"teacher"}', providerId: 'fixture', modelId: 'director' };
    };
    await runClassroomDiscussionGraph({
      userId: 'user-1',
      participants,
      messages: [
        { sender: 'agent', agentId: 'teacher', agentName: '林老师', content: '加法表示把数量合在一起。' },
        { sender: 'student', content: '我懂了。' },
      ],
      topic: '加法的含义',
      stateContext: 'Scene: 认识加法',
      model,
      emit: async () => undefined,
    });
    expect(spokenBy).toEqual([]);
    expect(directorCalls).toBe(0);
  });

  it('still sends an acknowledgment with a new question to the Director', async () => {
    const spokenBy: string[] = [];
    const model = fixtureModel(spokenBy);
    let directorCalls = 0;
    model.complete = async () => {
      directorCalls += 1;
      return {
        text: directorCalls === 1 ? '{"next_agent":"teacher"}' : '{"next_agent":"END"}',
        providerId: 'fixture',
        modelId: 'director',
      };
    };
    await runClassroomDiscussionGraph({
      userId: 'user-1',
      participants,
      messages: [
        { sender: 'agent', agentId: 'teacher', agentName: '林老师', content: '加法表示把数量合在一起。' },
        { sender: 'student', content: '我懂了，那减法也一样吗？' },
      ],
      topic: '加减法的含义',
      stateContext: 'Scene: 认识加减法',
      model,
      emit: async () => undefined,
    });
    expect(spokenBy).toEqual(['teacher']);
    expect(directorCalls).toBe(2);
  });

  it('injects the current classroom content and action position into each participant prompt', async () => {
    let participantSystem = '';
    const model = fixtureModel([]);
    model.stream = async function* (_userId, input) {
      participantSystem = input.system;
      yield { type: 'text_delta' as const, delta: '因为等式两边要保持平衡。' };
      yield { type: 'done' as const, providerId: 'fixture', modelId: 'participant' };
    };

    await runClassroomDiscussionGraph({
      userId: 'user-1',
      participants,
      messages: [],
      topic: '为什么移项要变号？',
      stateContext: [
        'Classroom: 一元一次方程',
        'Scene: 等式像天平',
        'Cursor: action 2 of 4',
        'Visible content: 天平左边是 x + 3，右边是 7。',
      ].join('\n'),
      model,
      emit: async () => undefined,
    });

    expect(participantSystem).toContain('天平左边是 x + 3，右边是 7。');
    expect(participantSystem).toContain('Cursor: action 2 of 4');
  });

  it('validates Chalkboard actions and exposes the updated board to the next Agent', async () => {
    const participantSystems: string[] = [];
    let directorCalls = 0;
    const model = fixtureModel([]);
    model.complete = async () => ({
      text: directorCalls++ === 0 ? '{"next_agent":"assistant"}' : '{"next_agent":"END"}',
      providerId: 'fixture',
      modelId: 'director',
    });
    model.stream = async function* (_userId, input) {
      participantSystems.push(input.system);
      if (input.agent.id === 'teacher') {
        yield { type: 'action' as const, actionId: 'open-board', actionName: 'wb_open', params: {} };
        yield {
          type: 'action' as const,
          actionId: 'draw-formula',
          actionName: 'wb_draw_latex',
          params: { elementId: 'formula', latex: 'x+3=8', x: 100, y: 80 },
        };
      }
      yield { type: 'text_delta' as const, delta: `${input.agent.name}解释。` };
      yield { type: 'done' as const, providerId: 'fixture', modelId: 'participant' };
    };
    const events: string[] = [];

    const result = await runClassroomDiscussionGraph({
      userId: 'user-1',
      participants,
      messages: [],
      topic: '解方程',
      stateContext: 'Scene: 等式像天平',
      model,
      emit: async (event) => { events.push(event.type); },
    });

    expect(events).toEqual(expect.arrayContaining(['action']));
    expect(result.liveChalkboard).toMatchObject({
      open: true,
      elements: [expect.objectContaining({ type: 'wb_draw_latex', elementId: 'formula' })],
    });
    expect(participantSystems[1]).toContain('x+3=8');
  });
});
