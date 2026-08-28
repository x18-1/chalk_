import { z } from 'zod';

import {
  applyLiveChalkboardAction,
  type LiveChalkboardPresentationState,
} from './presentation-state';
import type { Action } from './schema';

const id = z.string().trim().min(1).max(120);
const coordinateX = z.number().finite().min(0).max(1000);
const coordinateY = z.number().finite().min(0).max(562.5);
const width = z.number().finite().positive().max(1000);
const height = z.number().finite().positive().max(562.5);
const color = z.string().trim().min(1).max(40);
const base = { id, elementId: id.optional() };

const LiveChalkboardActionSchema = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('wb_open') }),
  z.object({ id, type: z.literal('wb_close') }),
  z.object({ id, type: z.literal('wb_clear') }),
  z.object({ id, type: z.literal('wb_delete'), elementId: id }),
  z.object({
    ...base,
    type: z.literal('wb_draw_text'),
    content: z.string().trim().min(1).max(4000),
    x: coordinateX,
    y: coordinateY,
    width: width.optional(),
    height: height.optional(),
    fontSize: z.number().finite().min(10).max(96).optional(),
    color: color.optional(),
  }),
  z.object({
    ...base,
    type: z.literal('wb_draw_shape'),
    shape: z.enum(['rectangle', 'circle', 'triangle']),
    x: coordinateX,
    y: coordinateY,
    width,
    height,
    fillColor: color.optional(),
  }),
  z.object({
    ...base,
    type: z.literal('wb_draw_chart'),
    chartType: z.enum(['bar', 'column', 'line', 'pie', 'ring', 'area', 'radar', 'scatter']),
    x: coordinateX,
    y: coordinateY,
    width,
    height,
    data: z.object({
      labels: z.array(z.string().max(120)).max(30),
      legends: z.array(z.string().max(120)).max(12),
      series: z.array(z.array(z.number().finite()).max(30)).max(12),
    }),
    themeColors: z.array(color).max(12).optional(),
  }),
  z.object({
    ...base,
    type: z.literal('wb_draw_latex'),
    latex: z.string().trim().min(1).max(4000),
    x: coordinateX,
    y: coordinateY,
    width: width.optional(),
    height: height.optional(),
    color: color.optional(),
  }),
  z.object({
    ...base,
    type: z.literal('wb_draw_table'),
    x: coordinateX,
    y: coordinateY,
    width,
    height,
    data: z.array(z.array(z.string().max(500)).max(20)).min(1).max(30),
    outline: z.object({ width: z.number().finite().min(0).max(10), style: z.string().max(40), color }).optional(),
    theme: z.object({ color }).optional(),
  }),
  z.object({
    ...base,
    type: z.literal('wb_draw_line'),
    startX: coordinateX,
    startY: coordinateY,
    endX: coordinateX,
    endY: coordinateY,
    color: color.optional(),
    width: z.number().finite().positive().max(20).optional(),
    style: z.enum(['solid', 'dashed']).optional(),
    points: z.tuple([z.enum(['', 'arrow']), z.enum(['', 'arrow'])]).optional(),
  }),
  z.object({
    ...base,
    type: z.literal('wb_draw_code'),
    language: z.string().trim().min(1).max(40),
    code: z.string().max(12_000),
    lineIds: z.array(id).max(500).optional(),
    x: coordinateX,
    y: coordinateY,
    width: width.optional(),
    height: height.optional(),
    fileName: z.string().trim().min(1).max(120).optional(),
  }),
  z.object({
    id,
    type: z.literal('wb_edit_code'),
    elementId: id,
    operation: z.enum(['insert_after', 'insert_before', 'delete_lines', 'replace_lines']),
    lineId: id.optional(),
    lineIds: z.array(id).min(1).max(100).optional(),
    newLineIds: z.array(id).max(100).optional(),
    content: z.string().max(12_000).optional(),
  }).superRefine((value, context) => {
    if ((value.operation === 'insert_after' || value.operation === 'insert_before') && (!value.lineId || !value.content)) {
      context.addIssue({ code: 'custom', message: 'insert operations require lineId and content' });
    }
    if ((value.operation === 'delete_lines' || value.operation === 'replace_lines') && !value.lineIds?.length) {
      context.addIssue({ code: 'custom', message: 'delete/replace operations require lineIds' });
    }
    if (value.operation === 'replace_lines' && !value.content) {
      context.addIssue({ code: 'custom', message: 'replace_lines requires content' });
    }
  }),
]);

export type LiveChalkboardAction = z.infer<typeof LiveChalkboardActionSchema>;
export type LiveChalkboardRejection =
  | 'invalid_params'
  | 'element_id_conflict'
  | 'element_not_found'
  | 'code_element_not_found'
  | 'code_line_not_found';

export function emptyChalkboardState(): LiveChalkboardPresentationState {
  return { open: false, elements: [] };
}

function elementId(action: Action) {
  return typeof action.elementId === 'string' && action.elementId ? action.elementId : action.id;
}

export function applyLiveChalkboardCommand(
  state: LiveChalkboardPresentationState,
  input: unknown,
): { ok: true; action: LiveChalkboardAction; state: LiveChalkboardPresentationState } |
  { ok: false; reason: LiveChalkboardRejection } {
  const parsed = LiveChalkboardActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid_params' };
  let action: LiveChalkboardAction = parsed.data;
  if ('x' in action && typeof action.x === 'number' && 'width' in action && typeof action.width === 'number' && action.x + action.width > 1000) {
    return { ok: false, reason: 'invalid_params' };
  }
  if ('y' in action && typeof action.y === 'number' && 'height' in action && typeof action.height === 'number' && action.y + action.height > 562.5) {
    return { ok: false, reason: 'invalid_params' };
  }
  const known = new Map(state.elements.map((element) => [elementId(element), element]));
  const actionElementId = 'elementId' in action ? action.elementId ?? action.id : action.id;
  if (action.type.startsWith('wb_draw_') && known.has(actionElementId)) {
    return { ok: false, reason: 'element_id_conflict' };
  }
  if (action.type === 'wb_delete' && !known.has(action.elementId)) {
    return { ok: false, reason: 'element_not_found' };
  }
  if (action.type === 'wb_edit_code') {
    const target = known.get(action.elementId);
    if (!target || target.type !== 'wb_draw_code') return { ok: false, reason: 'code_element_not_found' };
    const codeLines = typeof target.code === 'string' ? target.code.split('\n') : [];
    const knownLineIds = Array.isArray(target.lineIds) && target.lineIds.length === codeLines.length
      ? target.lineIds.filter((lineId): lineId is string => typeof lineId === 'string')
      : codeLines.map((_, index) => `L${index + 1}`);
    const targetLineIds = action.operation === 'insert_after' || action.operation === 'insert_before'
      ? [action.lineId!]
      : action.lineIds ?? [];
    if (targetLineIds.some((lineId) => !knownLineIds.includes(lineId))) {
      return { ok: false, reason: 'code_line_not_found' };
    }
    if (action.operation !== 'delete_lines') {
      const count = action.content!.split('\n').length;
      const requestedLineIds = action.newLineIds;
      const editActionId = action.id;
      action = {
        ...action,
        newLineIds: Array.from({ length: count }, (_, index) =>
          requestedLineIds?.[index] ?? `${editActionId}-line-${index + 1}`),
      };
    }
  }
  if (action.type === 'wb_draw_code') {
    action = {
      ...action,
      lineIds: action.lineIds?.length === action.code.split('\n').length
        ? action.lineIds
        : action.code.split('\n').map((_, index) => `L${index + 1}`),
    };
  }
  if (action.type === 'wb_draw_table') {
    const columnCount = action.data[0]?.length ?? 0;
    if (columnCount === 0 || action.data.some((row) => row.length !== columnCount)) {
      return { ok: false, reason: 'invalid_params' };
    }
  }
  return { ok: true, action, state: applyLiveChalkboardAction(state, action) };
}

export function replayLiveChalkboardActions(actions: readonly unknown[]) {
  return actions.reduce<LiveChalkboardPresentationState>((state, action) => {
    const applied = applyLiveChalkboardCommand(state, action);
    return applied.ok ? applied.state : state;
  }, emptyChalkboardState());
}

export function describeChalkboardState(state: LiveChalkboardPresentationState) {
  if (state.elements.length === 0) return `Live Chalkboard is ${state.open ? 'open' : 'closed'} and empty.`;
  const elements = state.elements.map((action) => {
    const payload = action.type === 'wb_draw_text' ? action.content
      : action.type === 'wb_draw_latex' ? action.latex
        : action.type === 'wb_draw_code' && typeof action.code === 'string' ? action.code.split('\n').map((line, index) =>
          `[${Array.isArray(action.lineIds) ? action.lineIds[index] ?? `L${index + 1}` : `L${index + 1}`}] ${line}`).join('\n')
          : action.type === 'wb_draw_table' || action.type === 'wb_draw_chart' ? JSON.stringify(action.data)
            : action.type === 'wb_draw_shape' ? action.shape
              : `${action.startX ?? ''},${action.startY ?? ''} -> ${action.endX ?? ''},${action.endY ?? ''}`;
    return `- [${elementId(action)}] ${action.type}: ${String(payload ?? '').slice(0, 600)}`;
  });
  return [`Live Chalkboard is ${state.open ? 'open' : 'closed'}.`, `Current elements (${state.elements.length}):`, ...elements].join('\n');
}
