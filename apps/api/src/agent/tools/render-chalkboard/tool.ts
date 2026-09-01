import { Type, type Static } from 'typebox';
import { SceneContentSchema, type SceneType } from '@chalk/chalkboard';

import { ToolExecutionError, type RuntimeTool } from '@chalk/agent-runtime';
import { RENDER_CHALKBOARD_PROMPT } from './prompts';

export { RENDER_CHALKBOARD_PROMPT } from './prompts';

const canvasParameters = Type.Object({
  viewportSize: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 4_000, description: 'Canvas width in coordinate units. Prefer 1000 for Chat teaching scenes.' })),
  viewportRatio: Type.Optional(Type.Number({ exclusiveMinimum: 0, maximum: 4, description: 'Canvas height divided by width. Prefer 0.5625 for a 1000 x 562.5 classroom canvas.' })),
  elements: Type.Optional(Type.Array(Type.Record(Type.String(), Type.Unknown(), { description: 'One normalized visual element. Prefer a small purposeful set of text, latex, line, shape, table, chart, image, video, or code elements.' }), { maxItems: 120, description: 'Elements in back-to-front render order. Keep slide scenes to roughly 10 purposeful elements.' })),
  // Models commonly emit a CSS color string. The adapter canonicalizes it
  // to Chalkboard's `{ color }` background object.
  background: Type.Optional(Type.Union([
    Type.String({ description: 'CSS color shorthand; the adapter normalizes it to { color }.' }),
    Type.Record(Type.String(), Type.Unknown()),
  ], { description: 'Canvas background. Prefer a light solid color with readable dark text.' })),
  theme: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: 'Optional visual theme values. Use sparingly; the scene should remain legible.' })),
}, { additionalProperties: true });

const chalkboardParameters = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 160, description: 'Short learner-facing title describing the single teaching purpose.' })),
  content: Type.Union([
    Type.Object({ type: Type.Literal('slide'), canvas: canvasParameters }, { additionalProperties: true, description: 'A visual teaching slide. Must contain a composed canvas; prefer diagram/formula/table over prose rows.' }),
    Type.Object({ type: Type.Literal('quiz'), questions: Type.Array(Type.Unknown(), { maxItems: 120, description: 'Read-only checkpoint questions. Keep to 1–3 focused questions with parallel options.' }), canvas: Type.Optional(canvasParameters) }, { additionalProperties: true, description: 'A small read-only knowledge checkpoint. Chat does not submit or grade answers.' }),
    Type.Object({ type: Type.Literal('interactive'), html: Type.String({ minLength: 1, maxLength: 200_000, description: 'Complete self-contained HTML with inline CSS/JavaScript and a visible canvas or SVG. No CDN, module import, or hidden initialization.' }), url: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096, description: 'Optional http(s) URL for an isolated read-only preview.' })), canvas: Type.Optional(canvasParameters) }, { additionalProperties: true, description: 'A self-contained simulation or animation where manipulation is part of the learning goal.' }),
    Type.Object({ type: Type.Literal('interactive'), url: Type.String({ minLength: 1, maxLength: 4_096, description: 'http(s) URL for an isolated read-only preview.' }), html: Type.Optional(Type.String({ minLength: 1, maxLength: 200_000, description: 'Optional self-contained HTML fallback.' })), canvas: Type.Optional(canvasParameters) }, { additionalProperties: true, description: 'A URL-backed simulation or animation where manipulation is part of the learning goal.' }),
  ], { description: 'Exactly one read-only teaching scene: slide, quiz, or interactive. Choose the smallest representation that serves the current learning goal.' }),
});

type ChalkboardArguments = Static<typeof chalkboardParameters>;
type ChatSceneType = Exclude<SceneType, 'pbl'>;
type SceneContent = {
  type: ChatSceneType;
  canvas?: Record<string, unknown>;
  questions?: unknown[];
  url?: string;
  html?: string;
  projectConfig?: Record<string, unknown>;
  [key: string]: unknown;
};

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readableTextColor(background: string): string {
  const match = background.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return '#333';
  const hex = match[1]!.length === 3 ? match[1]!.split('').map((digit) => digit + digit).join('') : match[1]!;
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 < 145 ? '#fff' : '#333';
}

const SUPPORTED_ELEMENT_TYPES = ['text', 'latex', 'line', 'shape', 'image', 'video', 'chart', 'code', 'table'] as const;

function invalidScene(path: string, message: string): never {
  throw new ToolExecutionError('invalid_arguments', `Scene validation failed at ${path}: ${message}`);
}

function normalizeCanvasElement(input: Record<string, unknown>, viewportSize: number, defaultTextColor: string, index: number) {
  const element = { ...input };
  const inputType = typeof element.type === 'string' ? element.type : '';
  if (element.draggable === true) {
    invalidScene(`content.canvas.elements[${index}].draggable`, 'Chat scenes are read-only; draggable geometry is not supported yet');
  }
  if (element.left === undefined && finiteNumber(element.x)) element.left = element.x;
  if (element.top === undefined && finiteNumber(element.y)) element.top = element.y;
  if (inputType === 'point' || inputType === 'circle') {
    const cx = finiteNumber(element.cx) ? element.cx : finiteNumber(element.x) ? element.x : undefined;
    const cy = finiteNumber(element.cy) ? element.cy : finiteNumber(element.y) ? element.y : undefined;
    const radius = finiteNumber(element.r) && element.r > 0 ? element.r : inputType === 'point' ? 6 : undefined;
    if (cx === undefined || cy === undefined || radius === undefined) {
      invalidScene(`content.canvas.elements[${index}]`, `${inputType} requires finite center coordinates and a positive radius`);
    }
    const width = radius * 2;
    element.type = 'shape';
    element.left = cx - radius;
    element.top = cy - radius;
    element.width = width;
    element.height = width;
    element.viewBox = [width, width];
    element.path = `M ${radius} 0 A ${radius} ${radius} 0 1 1 ${radius - 0.01} ${width} A ${radius} ${radius} 0 1 1 ${radius} 0 Z`;
    if (element.fill === undefined) element.fill = typeof element.color === 'string' ? element.color : defaultTextColor;
  }
  if (element.type === 'text') {
    if (element.content === undefined && typeof element.text === 'string') element.content = element.text;
    if (element.defaultColor === undefined && typeof element.color === 'string') element.defaultColor = element.color;
    if (element.defaultColor === undefined) element.defaultColor = defaultTextColor;
    // 12–13px labels become unreadable once a 1000-unit canvas is shown in a
    // chat column. Keep a legible floor for learner-facing scene text.
    const fontSize = finiteNumber(element.fontSize) ? Math.max(16, element.fontSize) : 16;
    element.fontSize = fontSize;
    const textValue = typeof element.content === 'string'
      ? element.content.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
      : '';
    // Estimate from the longest visual line, not the total character count.
    // Counting all lines made a three-line card description wider than its card.
    const longestLineLength = Math.max(...textValue.split(/\r?\n/).map((line) => Array.from(line).length), 1);
    const width = finiteNumber(element.width) ? element.width : Math.min(viewportSize, Math.max(32, longestLineLength * fontSize * 0.9 + 24));
    const lineCount = Math.max(1, textValue.split(/\r?\n/).length);
    const lineHeightValue = finiteNumber(element.lineHeight) ? element.lineHeight : 1.45;
    // Chalkboard's documented lineHeight is a multiplier (1–3), while some
    // generators emit an absolute pixel value (e.g. 26). Accept both forms.
    const lineHeight = lineHeightValue <= 4 ? fontSize * lineHeightValue : lineHeightValue;
    const height = finiteNumber(element.height)
      ? Math.max(element.height, fontSize * 1.25 + 4)
      : Math.max(44, lineCount * lineHeight + 16);
    if (element.width === undefined) element.width = width;
    if (element.height === undefined) element.height = height;
    const textAlign = typeof element.textAlign === 'string' ? element.textAlign : element.align;
    if (textAlign !== undefined && element.align === undefined) element.align = textAlign;
    if (textAlign === 'center' && finiteNumber(element.x) && element.left === element.x) element.left = element.x - width / 2;
    if (textAlign === 'right' && finiteNumber(element.x) && element.left === element.x) element.left = element.x - width;
  }
  if (element.type === 'rect') {
    const width = finiteNumber(element.width) ? element.width : finiteNumber(element.w) ? element.w : 40;
    const height = finiteNumber(element.height) ? element.height : finiteNumber(element.h) ? element.h : 30;
    element.type = 'shape';
    element.width = width;
    element.height = height;
    element.viewBox = [width, height];
    element.path = `M 0 0 H ${width} V ${height} H 0 Z`;
    if (element.outline === undefined && (typeof element.stroke === 'string' || finiteNumber(element.strokeWidth) || Array.isArray(element.dash))) {
      element.outline = {
        ...(typeof element.stroke === 'string' ? { color: element.stroke } : {}),
        ...(finiteNumber(element.strokeWidth) ? { width: element.strokeWidth } : {}),
        ...(Array.isArray(element.dash) ? { style: 'dashed' } : {}),
      };
    }
  }
  if (element.type === 'arrow' && Array.isArray(element.from) && Array.isArray(element.to)) {
    const from = element.from;
    const to = element.to;
    if (from.length === 2 && to.length === 2 && finiteNumber(from[0]) && finiteNumber(from[1]) && finiteNumber(to[0]) && finiteNumber(to[1])) {
      element.type = 'line';
      element.start = [from[0], from[1]];
      element.end = [to[0], to[1]];
      element.points = ['', 'arrow'];
      if (element.width === undefined && finiteNumber(element.strokeWidth)) element.width = element.strokeWidth;
    }
  }
  if (element.type === 'shape') {
    const width = finiteNumber(element.width) ? element.width : finiteNumber(element.w) ? element.w : 40;
    const height = finiteNumber(element.height) ? element.height : finiteNumber(element.h) ? element.h : 30;
    // The Chat tool accepts the common `shapeType` spelling used by
    // classroom/diagram generators as an alias for Chalkboard's `shape`.
    const shape = typeof element.shape === 'string'
      ? element.shape
      : typeof element.shapeType === 'string'
        ? element.shapeType
        : '';
    if (element.shape === undefined && shape) element.shape = shape;
    if (element.outline === undefined && (typeof element.stroke === 'string' || finiteNumber(element.strokeWidth))) {
      element.outline = {
        ...(typeof element.stroke === 'string' ? { color: element.stroke } : {}),
        ...(finiteNumber(element.strokeWidth) ? { width: element.strokeWidth } : {}),
      };
    }
    if (element.fill === undefined && typeof element.background === 'string') element.fill = element.background;
    if (element.path === undefined && shape === 'polygon' && Array.isArray(element.points)) {
      const points = element.points.filter((point): point is number[] => Array.isArray(point)
        && point.length >= 2 && finiteNumber(point[0]) && finiteNumber(point[1]));
      if (points.length >= 3) {
        const minX = Math.min(...points.map((point) => point[0]!));
        const minY = Math.min(...points.map((point) => point[1]!));
        const maxX = Math.max(...points.map((point) => point[0]!));
        const maxY = Math.max(...points.map((point) => point[1]!));
        element.left = minX;
        element.top = minY;
        element.width = maxX - minX;
        element.height = maxY - minY;
        element.viewBox = [Math.max(1, maxX - minX), Math.max(1, maxY - minY)];
        element.path = `${points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point[0]! - minX} ${point[1]! - minY}`).join(' ')} Z`;
      }
    }
    if (element.path === undefined && shape === 'circle') {
      const radius = Math.min(width, height) / 2;
      element.viewBox = [width, height];
      element.path = `M ${width / 2} 0 A ${radius} ${radius} 0 1 1 ${width / 2 - 0.01} ${height} A ${radius} ${radius} 0 1 1 ${width / 2} 0 Z`;
    }
    if (element.path === undefined && (shape === 'ellipse' || shape === 'oval')) {
      // Keep the ellipse in the element's local coordinate system so the
      // renderer can position and scale it with the same left/top/width/
      // height contract as every other shape.
      const radiusX = width / 2;
      const radiusY = height / 2;
      const centerX = radiusX;
      element.shape = 'ellipse';
      element.viewBox = [width, height];
      element.path = `M ${centerX} 0 A ${radiusX} ${radiusY} 0 1 1 ${centerX} ${height} A ${radiusX} ${radiusY} 0 1 1 ${centerX} 0 Z`;
    }
    if (element.path === undefined && (shape === 'roundedRect' || shape === 'rounded-rect')) {
      const radius = Math.min(finiteNumber(element.rx) ? element.rx : 12, width / 2, height / 2);
      element.viewBox = [width, height];
      element.path = `M ${radius} 0 H ${width - radius} Q ${width} 0 ${width} ${radius} V ${height - radius} Q ${width} ${height} ${width - radius} ${height} H ${radius} Q 0 ${height} 0 ${height - radius} V ${radius} Q 0 0 ${radius} 0 Z`;
    }
    if (element.path === undefined && (shape === 'rect' || shape === 'rectangle')) {
      element.viewBox = [width, height];
      element.path = `M 0 0 H ${width} V ${height} H 0 Z`;
    }
    if (element.path === undefined && shape === 'arrow') {
      element.viewBox = [width, height];
      element.path = `M 0 ${height * 0.35} H ${width * 0.58} V 0 L ${width} ${height / 2} L ${width * 0.58} ${height} V ${height * 0.65} H 0 Z`;
    }
  }
  if (element.type === 'latex' && element.latex === undefined && typeof element.text === 'string') element.latex = element.text;
  if ((element.type === 'image' || element.type === 'video') && element.src === undefined && typeof element.url === 'string') element.src = element.url;
  if (element.type === 'line') {
    if (element.start === undefined && finiteNumber(element.x1) && finiteNumber(element.y1)) element.start = [element.x1, element.y1];
    if (element.end === undefined && finiteNumber(element.x2) && finiteNumber(element.y2)) element.end = [element.x2, element.y2];
    if (element.width === undefined && finiteNumber(element.strokeWidth)) element.width = element.strokeWidth;
    if (element.color === undefined && typeof element.stroke === 'string') element.color = element.stroke;
  }
  const normalizedType = typeof element.type === 'string' ? element.type : '';
  if (!(SUPPORTED_ELEMENT_TYPES as readonly string[]).includes(normalizedType)) {
    invalidScene(`content.canvas.elements[${index}].type`, `unsupported element type "${inputType || '(missing)'}"; supported types are ${SUPPORTED_ELEMENT_TYPES.join(', ')}`);
  }
  return element;
}

function normalizeRenderSceneContent(input: unknown): SceneContent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalidScene('content', 'must be an object');
  const content = input as SceneContent;
  if (!['slide', 'quiz', 'interactive'].includes(content.type)) invalidScene('content.type', 'must be one of slide, quiz, interactive; PBL is not available in Chat');
  if (content.type === 'slide' && (!content.canvas || typeof content.canvas !== 'object' || Array.isArray(content.canvas))) invalidScene('content.canvas', 'slide content requires an object `canvas`');
  if (content.type === 'quiz' && !Array.isArray(content.questions)) invalidScene('content.questions', 'quiz content requires a `questions` array');
  if (content.type === 'interactive' && typeof content.url !== 'string' && typeof content.html !== 'string') invalidScene('content', 'interactive content requires `url` or `html`');
  if (content.type !== 'slide' || !content.canvas) return content;
  const viewportRatio = content.canvas.viewportRatio;
  const rawBackground = content.canvas.background;
  const background = typeof rawBackground === 'string'
    ? { color: rawBackground }
    : rawBackground;
  const backgroundColor = background && typeof background === 'object' && !Array.isArray(background)
    ? typeof (background as Record<string, unknown>).color === 'string'
      ? (background as Record<string, unknown>).color as string
      : typeof (background as Record<string, unknown>).fill === 'string'
        ? (background as Record<string, unknown>).fill as string
        : '#ffffff'
    : '#ffffff';
  const viewportSize = finiteNumber(content.canvas.viewportSize) ? content.canvas.viewportSize : 1000;
  const elements = Array.isArray(content.canvas.elements) ? content.canvas.elements as Record<string, unknown>[] : undefined;
  return {
    ...content,
    canvas: {
      ...content.canvas,
      ...(background !== rawBackground ? { background } : {}),
      ...(typeof viewportRatio === 'number' && viewportRatio > 1 ? { viewportRatio: 1 / viewportRatio } : {}),
      ...(elements ? { elements: elements.map((element, index) => normalizeCanvasElement(element, viewportSize, readableTextColor(backgroundColor), index)) } : {}),
    },
  };
}

function prepareChalkboardArguments(args: unknown): ChalkboardArguments {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return args as ChalkboardArguments;
  const record = args as Record<string, unknown>;
  const rawContent = record.content;
  if (!rawContent || typeof rawContent !== 'object' || Array.isArray(rawContent)) {
    return args as ChalkboardArguments;
  }
  const content = rawContent as Record<string, unknown>;
  const rawCanvas = content.canvas;
  const canvas = rawCanvas && typeof rawCanvas === 'object' && !Array.isArray(rawCanvas)
    ? rawCanvas as Record<string, unknown>
    : undefined;
  const rawBackground = canvas?.background;
  const normalizedCanvas = typeof rawBackground === 'string'
    ? { ...canvas, background: { color: rawBackground } }
    : canvas;
  const normalizedContent = normalizedCanvas && normalizedCanvas !== rawCanvas
    ? { ...content, canvas: normalizedCanvas }
    : content;
  // Models sometimes omit the discriminator when retrying a slide call. A canvas
  // is unambiguously the slide content shape, so fill it before TypeBox validation.
  if (normalizedContent.type === undefined && normalizedCanvas) {
    return { ...record, content: { ...normalizedContent, type: 'slide' } } as ChalkboardArguments;
  }
  return normalizedContent !== content
    ? { ...record, content: normalizedContent } as ChalkboardArguments
    : args as ChalkboardArguments;
}

export type RenderChalkboardDetails = {
  type: 'scene';
  scene: {
    id: string;
    title: string;
    order: number;
    type: ChatSceneType;
    actionCount: 0;
    content: SceneContent;
  };
};

export function createRenderChalkboardTool(): RuntimeTool<typeof chalkboardParameters, RenderChalkboardDetails> {
  return {
    name: 'render_chalkboard',
    label: '插入 Chalkboard Scene',
    description: RENDER_CHALKBOARD_PROMPT,
    parameters: chalkboardParameters,
    source: 'chalk',
    effects: ['read'],
    approvalPolicy: 'none',
    defaultEnabled: true,
    executionMode: 'sequential',
    prepareArguments: prepareChalkboardArguments,
    limits: { maxResultCharacters: 2_000, maxUpdateCharacters: 1_000 },
    async execute(args: ChalkboardArguments) {
      const normalized = normalizeRenderSceneContent(args.content);
      const parsed = SceneContentSchema.safeParse(normalized);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        invalidScene(issue?.path.join('.') || 'content', issue?.message ?? 'content is invalid');
      }
      const content = parsed.data as SceneContent;
      const title = args.title ?? 'Chalkboard Scene';
      return {
        content: [{ type: 'text', text: `已插入只读 ${content.type} Scene「${title}」。Chat 仅展示内容，不执行 Action、互动操作或 Quiz 提交。` }],
        details: {
          type: 'scene',
          scene: {
            id: `chat-scene-${title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-').replace(/^-+|-+$/g, '') || 'content'}`,
            title,
            order: 0,
            type: content.type,
            actionCount: 0,
            content,
          },
        },
      };
    },
  };
}
