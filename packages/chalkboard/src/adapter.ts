import { z } from 'zod';
import { createChalkboardRuntime, type ChalkboardRuntime } from './runtime';
import { parseStageDocument, type Action, type Scene, type StageDocument, type SceneType } from './schema';

const OpenMaicClassroomResponseSchema = z.object({
  success: z.literal(true),
  classroom: z.unknown(),
});

export interface SceneView {
  id: string;
  title: string;
  order: number;
  type: SceneType;
  actionCount: number;
  content: Record<string, unknown>;
}

export interface ClassroomParticipant {
  id: string;
  name: string;
  role: 'teacher' | 'assistant' | 'student';
  avatar?: string;
  color?: string;
  persona?: string;
}

export interface AdaptedClassroom {
  document: StageDocument;
  runtime: ChalkboardRuntime;
  scenes: readonly SceneView[];
  participants: readonly ClassroomParticipant[];
}

export type ActionEffect =
  | { kind: 'speech'; text: string }
  | { kind: 'spotlight'; elementId: string }
  | { kind: 'laser'; elementId: string }
  | { kind: 'play_video'; elementId: string }
  | { kind: 'discussion'; topic: string; prompt?: string; agentId?: string }
  | { kind: 'widget_highlight'; target: string; content?: string }
  | { kind: 'widget_set_state'; state: Record<string, unknown>; content?: string }
  | { kind: 'widget_annotation'; target: string; content?: string }
  | { kind: 'widget_reveal'; target: string; content?: string }
  | { kind: 'live_chalkboard'; action: Action };

export interface ActionExecutor {
  speak(text: string): void | Promise<void>;
  spotlight(elementId: string): void | Promise<void>;
  laser?(elementId: string): void | Promise<void>;
  playVideo?(elementId: string): void | Promise<void>;
  discussion(input: { topic: string; prompt?: string; agentId?: string }): void | Promise<void>;
  widgetHighlight(input: { target: string; content?: string }): void | Promise<void>;
  widgetSetState?(input: { state: Record<string, unknown>; content?: string }): void | Promise<void>;
  widgetAnnotation?(input: { target: string; content?: string }): void | Promise<void>;
  widgetReveal?(input: { target: string; content?: string }): void | Promise<void>;
  liveChalkboard?(action: Action): void | Promise<void>;
}

export type ActionExecutionResult =
  | { ok: true; effect: ActionEffect }
  | { ok: false; error: { code: 'UNSUPPORTED_ACTION'; actionType: string } };

/**
 * Convert the HTTP envelope returned by OpenMAIC into the core Stage document
 * and the runtime/view seams consumed by Web or another presentation host.
 */
export function adaptOpenMaicClassroomResponse(input: unknown): AdaptedClassroom {
  const response = OpenMaicClassroomResponseSchema.parse(input);
  const normalizedClassroom = normalizeClassroomDocument(response.classroom);
  const document = parseStageDocument(normalizedClassroom);
  return {
    document,
    runtime: createChalkboardRuntime(document),
    scenes: document.scenes
      .slice()
      .sort((left, right) => left.order - right.order)
      .map(toSceneView),
    participants: participantsFromClassroom(normalizedClassroom),
  };
}

function participantsFromClassroom(input: unknown): ClassroomParticipant[] {
  if (typeof input !== 'object' || input === null) return [];
  const value = input as Record<string, unknown>;
  const rawStage = typeof value.stage === 'object' && value.stage !== null ? value.stage as Record<string, unknown> : {};
  const agents = Array.isArray(value.agents)
    ? value.agents
    : Array.isArray(rawStage.agentProfiles)
      ? rawStage.agentProfiles
      : Array.isArray(rawStage.agentIds)
        ? rawStage.agentIds.map((id) => ({ id }))
        : [];
  return agents.flatMap((rawAgent, index) => {
    if (typeof rawAgent === 'string') {
      return [{ id: rawAgent, name: rawAgent, role: 'student' as const }];
    }
    if (typeof rawAgent !== 'object' || rawAgent === null) return [];
    const agent = rawAgent as Record<string, unknown>;
    const role = agent.role === 'teacher' ? 'teacher' : agent.role === 'assistant' ? 'assistant' : 'student';
    return [{
      id: typeof agent.id === 'string' ? agent.id : `agent-${index + 1}`,
      name: typeof agent.name === 'string' && agent.name.trim()
        ? agent.name
        : typeof agent.id === 'string' && agent.id.trim()
          ? agent.id
          : `课堂成员 ${index + 1}`,
      role,
      ...(typeof agent.avatar === 'string' ? { avatar: agent.avatar } : {}),
      ...(typeof agent.color === 'string' ? { color: agent.color } : {}),
      ...(typeof agent.persona === 'string' ? { persona: agent.persona } : {}),
    }];
  });
}

/**
 * OpenMAIC's `.maic.zip` manifest deliberately omits runtime IDs and stage
 * ownership fields.  The server response contains those fields already, but
 * keeping this normalization at the adapter boundary lets imported classroom
 * packages and HTTP classrooms share the same render/runtime contract.
 */
export function normalizeClassroomDocument(input: unknown, fallbackStageId = 'imported-classroom'): unknown {
  const value = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
  const rawStage = typeof value.stage === 'object' && value.stage !== null ? value.stage as Record<string, unknown> : {};
  const stageId = typeof rawStage.id === 'string' && rawStage.id.trim()
    ? rawStage.id
    : typeof value.id === 'string' && value.id.trim()
      ? value.id
      : fallbackStageId;
  const now = Date.now();
  const stage = {
    ...rawStage,
    id: stageId,
    name: typeof rawStage.name === 'string' && rawStage.name.trim() ? rawStage.name : 'Imported Classroom',
    createdAt: typeof rawStage.createdAt === 'number' ? rawStage.createdAt : now,
    updatedAt: typeof rawStage.updatedAt === 'number' ? rawStage.updatedAt : now,
    ...(Array.isArray(value.agents) ? { agentProfiles: value.agents } : {}),
  };
  const scenes = Array.isArray(value.scenes) ? value.scenes.map((rawScene, index) => {
    const scene = typeof rawScene === 'object' && rawScene !== null ? rawScene as Record<string, unknown> : {};
    const order = typeof scene.order === 'number' ? scene.order : index;
    const sceneId = typeof scene.id === 'string' && scene.id.trim() ? scene.id : `${stageId}-scene-${order + 1}`;
    const actions = Array.isArray(scene.actions) ? scene.actions.map((rawAction, actionIndex) => {
      const action = typeof rawAction === 'object' && rawAction !== null ? rawAction as Record<string, unknown> : {};
      return {
        ...action,
        id: typeof action.id === 'string' && action.id.trim() ? action.id : `${sceneId}-action-${actionIndex + 1}`,
      };
    }) : undefined;
    return {
      ...scene,
      id: sceneId,
      stageId,
      order,
      title: typeof scene.title === 'string' ? scene.title : `Scene ${order + 1}`,
      createdAt: typeof scene.createdAt === 'number' ? scene.createdAt : now,
      updatedAt: typeof scene.updatedAt === 'number' ? scene.updatedAt : now,
      actions,
    };
  }) : [];
  return { ...value, stage, scenes };
}

export function toSceneView(scene: Scene): SceneView {
  return {
    id: scene.id,
    title: scene.title,
    order: scene.order,
    type: scene.type,
    actionCount: scene.actions?.length ?? 0,
    content: scene.content as Record<string, unknown>,
  };
}

export function toActionEffect(action: Action): ActionEffect | null {
  if (action.type.startsWith('wb_')) return { kind: 'live_chalkboard', action };
  switch (action.type) {
    case 'speech':
      return { kind: 'speech', text: action.text as string };
    case 'spotlight':
      return { kind: 'spotlight', elementId: action.elementId as string };
    case 'laser':
      return { kind: 'laser', elementId: action.elementId as string };
    case 'play_video':
      return { kind: 'play_video', elementId: action.elementId as string };
    case 'discussion':
      return {
        kind: 'discussion',
        topic: action.topic as string,
        ...(typeof action.prompt === 'string' ? { prompt: action.prompt } : {}),
        ...(typeof action.agentId === 'string' ? { agentId: action.agentId } : {}),
      };
    case 'widget_highlight':
      return {
        kind: 'widget_highlight',
        target: action.target as string,
        ...(typeof action.content === 'string' ? { content: action.content } : {}),
      };
    case 'widget_setState':
      return {
        kind: 'widget_set_state',
        state: (typeof action.state === 'object' && action.state !== null && !Array.isArray(action.state)) ? action.state as Record<string, unknown> : {},
        content: typeof action.content === 'string' ? action.content : undefined,
      };
    case 'widget_annotation':
      return {
        kind: 'widget_annotation',
        target: action.target as string,
        content: typeof action.content === 'string' ? action.content : undefined,
      };
    case 'widget_reveal':
      return {
        kind: 'widget_reveal',
        target: action.target as string,
        content: typeof action.content === 'string' ? action.content : undefined,
      };
    default:
      return null;
  }
}

export async function executeAction(
  action: Action,
  executor: ActionExecutor,
): Promise<ActionExecutionResult> {
  const effect = toActionEffect(action);
  if (!effect) {
    return { ok: false, error: { code: 'UNSUPPORTED_ACTION', actionType: action.type } };
  }

  switch (effect.kind) {
    case 'speech':
      await executor.speak(effect.text);
      break;
    case 'spotlight':
      await executor.spotlight(effect.elementId);
      break;
    case 'laser':
      if (!executor.laser) return { ok: false, error: { code: 'UNSUPPORTED_ACTION', actionType: action.type } };
      await executor.laser(effect.elementId);
      break;
    case 'play_video':
      if (!executor.playVideo) return { ok: false, error: { code: 'UNSUPPORTED_ACTION', actionType: action.type } };
      await executor.playVideo(effect.elementId);
      break;
    case 'discussion':
      await executor.discussion(effect);
      break;
    case 'widget_highlight':
      await executor.widgetHighlight(effect);
      break;
    case 'widget_set_state':
      if (!executor.widgetSetState) return { ok: false, error: { code: 'UNSUPPORTED_ACTION', actionType: action.type } };
      await executor.widgetSetState(effect);
      break;
    case 'widget_annotation':
      if (!executor.widgetAnnotation) return { ok: false, error: { code: 'UNSUPPORTED_ACTION', actionType: action.type } };
      await executor.widgetAnnotation(effect);
      break;
    case 'widget_reveal':
      if (!executor.widgetReveal) return { ok: false, error: { code: 'UNSUPPORTED_ACTION', actionType: action.type } };
      await executor.widgetReveal(effect);
      break;
    case 'live_chalkboard':
      if (!executor.liveChalkboard) return { ok: false, error: { code: 'UNSUPPORTED_ACTION', actionType: action.type } };
      await executor.liveChalkboard(effect.action);
      break;
  }
  return { ok: true, effect };
}
