import type { Action } from './schema';

export interface WhiteboardPresentationState {
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
  whiteboard: WhiteboardPresentationState;
}

export function emptyScenePresentation(): ScenePresentationState {
  return {
    discussion: '',
    widget: { highlightTarget: null, state: null, annotation: null, revealTarget: null },
    whiteboard: { open: false, elements: [] },
  };
}

function whiteboardElementId(action: Action): string {
  return typeof action.elementId === 'string' && action.elementId ? action.elementId : action.id;
}

export function applyWhiteboardAction(
  state: WhiteboardPresentationState,
  action: Action,
): WhiteboardPresentationState {
  if (action.type === 'wb_open') return { ...state, open: true };
  if (action.type === 'wb_close') return { ...state, open: false };
  if (action.type === 'wb_clear') return { open: true, elements: [] };
  if (action.type === 'wb_delete') {
    return {
      open: true,
      elements: state.elements.filter((element) => whiteboardElementId(element) !== action.elementId),
    };
  }
  if (action.type === 'wb_edit_code') {
    return {
      open: true,
      elements: state.elements.map((element) => {
        if (whiteboardElementId(element) !== action.elementId) return element;
        return {
          ...element,
          ...(typeof action.code === 'string' ? { code: action.code } : {}),
          lastEdit: action.operation,
        };
      }),
    };
  }
  if (action.type.startsWith('wb_draw_')) {
    const id = whiteboardElementId(action);
    return {
      open: true,
      elements: [...state.elements.filter((element) => whiteboardElementId(element) !== id), action],
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
      state.whiteboard = applyWhiteboardAction(state.whiteboard, action);
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
