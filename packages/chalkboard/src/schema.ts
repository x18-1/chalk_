import { z } from 'zod';

export type SceneType = 'slide' | 'quiz' | 'interactive' | 'pbl';

/** Serialized canvas element shared by slide renderers and imported packages. */
export interface CanvasElement {
  id?: string;
  type?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  rotate?: number;
  content?: string;
  latex?: string;
  html?: string;
  color?: string;
  defaultColor?: string;
  fill?: string;
  src?: string;
  mediaRef?: string;
  poster?: string;
  controls?: boolean;
  autoplay?: boolean;
  path?: string;
  viewBox?: [number, number];
  outline?: { color?: string; width?: number; style?: string };
  opacity?: number;
  start?: [number, number];
  end?: [number, number];
  style?: string;
  points?: [string, string];
  broken?: [number, number];
  broken2?: [number, number];
  curve?: [number, number];
  cubic?: [[number, number], [number, number]];
  colWidths?: number[];
  data?: unknown[][];
  [key: string]: unknown;
}

export interface SlideContent {
  type: 'slide';
  canvas: {
    viewportSize?: number;
    viewportRatio?: number;
    elements?: CanvasElement[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface QuizQuestion {
  id: string;
  type: 'single' | 'multiple' | 'short_answer';
  question: string;
  options?: Array<{ value: string; label: string }>;
  answer?: string[];
  analysis?: string;
  points?: number;
  [key: string]: unknown;
}

export interface Action {
  id: string;
  type: string;
  [key: string]: unknown;
}

export interface Stage {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  [key: string]: unknown;
}

export interface Scene {
  id: string;
  stageId: string;
  type: SceneType;
  title: string;
  order: number;
  content: {
    type: SceneType;
    [key: string]: unknown;
  };
  actions?: Action[];
  [key: string]: unknown;
}

export interface StageDocument {
  stage: Stage;
  scenes: Scene[];
}

const ACTION_REQUIRED_FIELDS: Record<string, Record<string, 'string' | 'number' | 'object' | 'array'>> = {
  spotlight: { elementId: 'string' },
  laser: { elementId: 'string' },
  play_video: { elementId: 'string' },
  speech: { text: 'string' },
  wb_draw_text: { content: 'string', x: 'number', y: 'number' },
  wb_draw_shape: { shape: 'string', x: 'number', y: 'number', width: 'number', height: 'number' },
  wb_draw_chart: {
    chartType: 'string', x: 'number', y: 'number', width: 'number', height: 'number', data: 'object',
  },
  wb_draw_latex: { latex: 'string', x: 'number', y: 'number' },
  wb_draw_table: { x: 'number', y: 'number', width: 'number', height: 'number', data: 'array' },
  wb_draw_line: { startX: 'number', startY: 'number', endX: 'number', endY: 'number' },
  wb_draw_code: { language: 'string', code: 'string', x: 'number', y: 'number' },
  wb_edit_code: { elementId: 'string', operation: 'string' },
  wb_open: {},
  wb_clear: {},
  wb_delete: { elementId: 'string' },
  wb_close: {},
  discussion: { topic: 'string' },
  widget_highlight: { target: 'string' },
  widget_setState: { state: 'object' },
  widget_annotation: { target: 'string' },
  widget_reveal: { target: 'string' },
};

function matchesKind(value: unknown, kind: 'string' | 'number' | 'object' | 'array'): boolean {
  if (kind === 'array') return Array.isArray(value);
  if (kind === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  return typeof value === kind && (kind !== 'number' || Number.isFinite(value));
}

export const ActionSchema = z
  .object({ id: z.string().min(1), type: z.string().min(1) })
  .passthrough()
  .superRefine((action, ctx) => {
    const required = ACTION_REQUIRED_FIELDS[action.type];
    if (!required) {
      ctx.addIssue({ code: 'custom', path: ['type'], message: `unknown action type: ${JSON.stringify(action.type)}` });
      return;
    }
    for (const [field, kind] of Object.entries(required)) {
      if (action[field] === undefined) {
        ctx.addIssue({ code: 'custom', path: [field], message: `${action.type} action requires \`${field}\`` });
      } else if (!matchesKind(action[field], kind)) {
        ctx.addIssue({ code: 'custom', path: [field], message: `${action.type} action field \`${field}\` must be ${kind}` });
      }
    }
  });

const ContentSchema = z.object({ type: z.string() }).passthrough();

export const SceneSchema = z
  .object({
    id: z.string().min(1),
    stageId: z.string().min(1),
    type: z.enum(['slide', 'quiz', 'interactive', 'pbl']),
    title: z.string(),
    order: z.number().int().nonnegative(),
    content: ContentSchema,
    actions: z.array(ActionSchema).optional(),
  })
  .passthrough()
  .superRefine((scene, ctx) => {
    if (scene.content.type !== scene.type) {
      ctx.addIssue({ code: 'custom', path: ['content', 'type'], message: 'content type must match scene type' });
      return;
    }
    const content = scene.content;
    if (scene.type === 'slide' && (typeof content.canvas !== 'object' || content.canvas === null || Array.isArray(content.canvas))) {
      ctx.addIssue({ code: 'custom', path: ['content', 'canvas'], message: 'slide content requires an object `canvas`' });
    }
    if (scene.type === 'quiz' && !Array.isArray(content.questions)) {
      ctx.addIssue({ code: 'custom', path: ['content', 'questions'], message: 'quiz content requires a `questions` array' });
    }
    if (scene.type === 'interactive' && typeof content.url !== 'string') {
      ctx.addIssue({ code: 'custom', path: ['content', 'url'], message: 'interactive content requires a string `url`' });
    }
    if (scene.type === 'pbl' && (typeof content.projectConfig !== 'object' || content.projectConfig === null || Array.isArray(content.projectConfig))) {
      ctx.addIssue({ code: 'custom', path: ['content', 'projectConfig'], message: 'pbl content requires an object `projectConfig`' });
    }
  });

export const StageMetadataSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    createdAt: z.number().finite(),
    updatedAt: z.number().finite(),
  })
  .passthrough();

export const StageDocumentSchema = z
  .object({ stage: StageMetadataSchema, scenes: z.array(SceneSchema).min(1) })
  .superRefine((document, ctx) => {
    const ids = new Set<string>();
    for (const [index, scene] of document.scenes.entries()) {
      if (scene.stageId !== document.stage.id) {
        ctx.addIssue({ code: 'custom', path: ['scenes', index, 'stageId'], message: 'scene stageId must match stage.id' });
      }
      if (ids.has(scene.id)) {
        ctx.addIssue({ code: 'custom', path: ['scenes', index, 'id'], message: 'scene id must be unique' });
      }
      ids.add(scene.id);
    }
  });

// Public name used by the first Chalkboard seam: it validates the complete
// Stage -> Scene -> Action document, not only the metadata envelope.
export const StageSchema = StageDocumentSchema;

export function parseStageDocument(input: unknown): StageDocument {
  return StageDocumentSchema.parse(input) as StageDocument;
}

export function validateStageDocument(input: unknown): ReturnType<typeof StageDocumentSchema.safeParse> {
  return StageDocumentSchema.safeParse(input);
}
