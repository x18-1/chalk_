import type { Action } from './schema';

export interface LiveChalkboardPresentationState {
  open: boolean;
  elements: readonly Action[];
}

export interface WidgetPresentationState {
  highlightTarget: string | null;
  state: Record<string, unknown> | null;
  annotation: { target: string; content?: string } | null;
  revealTarget: string | null;
}

export interface ScenePresentationState {
  discussion: string;
  widget: WidgetPresentationState;
  liveChalkboard: LiveChalkboardPresentationState;
}

export function emptyScenePresentation(): ScenePresentationState {
  return {
    discussion: '',
    widget: { highlightTarget: null, state: null, annotation: null, revealTarget: null },
    liveChalkboard: { open: false, elements: [] },
  };
}

function chalkboardElementId(action: Action): string {
  return typeof action.elementId === 'string' && action.elementId ? action.elementId : action.id;
}

function editCode(code: string, currentLineIds: unknown, action: Action) {
  const lines = code.split('\n');
  const lineIds = Array.isArray(currentLineIds) && currentLineIds.length === lines.length && currentLineIds.every((id) => typeof id === 'string')
    ? [...currentLineIds] as string[]
    : lines.map((_, index) => `L${index + 1}`);
  const lineIndex = (lineId: unknown) => typeof lineId === 'string' ? lineIds.indexOf(lineId) : -1;
  const content = typeof action.content === 'string' ? action.content.split('\n') : [];
  const newLineIds = Array.isArray(action.newLineIds) && action.newLineIds.length === content.length && action.newLineIds.every((id) => typeof id === 'string')
    ? action.newLineIds as string[]
    : content.map((_, index) => `${action.id}-line-${index + 1}`);
  const operation = action.operation;
  if (operation === 'insert_after' || operation === 'insert_before') {
    const index = lineIndex(action.lineId);
    if (index < 0 || index >= lines.length || content.length === 0) return { code, lineIds };
    const insertAt = operation === 'insert_after' ? index + 1 : index;
    lines.splice(insertAt, 0, ...content);
    lineIds.splice(insertAt, 0, ...newLineIds);
    return { code: lines.join('\n'), lineIds };
  }
  const indices = Array.isArray(action.lineIds)
    ? action.lineIds.map(lineIndex).filter((index) => index >= 0 && index < lines.length)
    : [];
  if (indices.length === 0) return { code, lineIds };
  const first = Math.min(...indices);
  const remove = new Set(indices);
  const retained = lines.filter((_, index) => !remove.has(index));
  const retainedIds = lineIds.filter((_, index) => !remove.has(index));
  if (operation === 'replace_lines' && content.length > 0) {
    retained.splice(first, 0, ...content);
    retainedIds.splice(first, 0, ...newLineIds);
  }
  return { code: retained.join('\n'), lineIds: retainedIds };
}

export function applyLiveChalkboardAction(
  state: LiveChalkboardPresentationState,
  action: Action,
): LiveChalkboardPresentationState {
  if (action.type === 'wb_open') return { ...state, open: true };
  if (action.type === 'wb_close') return { ...state, open: false };
  if (action.type === 'wb_clear') return { open: true, elements: [] };
  if (action.type === 'wb_delete') {
    return {
      open: true,
      elements: state.elements.filter((element) => chalkboardElementId(element) !== action.elementId),
    };
  }
  if (action.type === 'wb_edit_code') {
    return {
      open: true,
      elements: state.elements.map((element) => {
        if (chalkboardElementId(element) !== action.elementId) return element;
        const edited = typeof element.code === 'string'
          ? editCode(element.code, element.lineIds, action)
          : null;
        return {
          ...element,
          ...(edited ?? {}),
          lastEdit: action.operation,
        };
      }),
    };
  }
  if (action.type.startsWith('wb_draw_')) {
    const id = chalkboardElementId(action);
    return {
      open: true,
      elements: [...state.elements.filter((element) => chalkboardElementId(element) !== id), action],
    };
  }
  return state;
}

/** Reconstruct durable scene visuals without replaying transient media,
 * speech, spotlight, or laser effects. The cursor points at the next/current
 * action, therefore only the prefix before it has already taken effect. */
export function projectScenePresentation(
  actions: readonly Action[],
  actionIndex: number,
): ScenePresentationState {
  const state = emptyScenePresentation();
  const limit = Math.max(0, Math.min(actions.length, actionIndex));
  for (const action of actions.slice(0, limit)) {
    if (action.type.startsWith('wb_')) {
      state.liveChalkboard = applyLiveChalkboardAction(state.liveChalkboard, action);
      continue;
    }
    if (action.type === 'discussion' && typeof action.topic === 'string') {
      state.discussion = action.topic;
      continue;
    }
    if (action.type === 'widget_highlight' && typeof action.target === 'string') {
      state.widget.highlightTarget = action.target;
      continue;
    }
    if (action.type === 'widget_setState' && typeof action.state === 'object' && action.state !== null && !Array.isArray(action.state)) {
      state.widget.state = action.state as Record<string, unknown>;
      continue;
    }
    if (action.type === 'widget_annotation' && typeof action.target === 'string') {
      state.widget.annotation = {
        target: action.target,
        ...(typeof action.content === 'string' ? { content: action.content } : {}),
      };
      continue;
    }
    if (action.type === 'widget_reveal' && typeof action.target === 'string') {
      state.widget.revealTarget = action.target;
    }
  }
  return state;
}
