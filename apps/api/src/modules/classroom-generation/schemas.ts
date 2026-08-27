import { z } from 'zod';

const mediaAspectRatioSchema = z.enum(['16:9', '4:3', '1:1', '9:16', '3:4', '21:9']);

const classroomImageGenerationConfigSchema = z.object({
  providerId: z.enum(['openai', 'qwen', 'seedream', 'minimax', 'grok', 'nano-banana', 'comfyui', 'lemonade']),
  model: z.string().trim().min(1).max(200).optional(),
  aspectRatio: mediaAspectRatioSchema.optional(),
  width: z.number().int().min(256).max(4096).optional(),
  height: z.number().int().min(256).max(4096).optional(),
  negativePrompt: z.string().trim().max(4_000).optional(),
}).strict();

const classroomVideoGenerationConfigSchema = z.object({
  providerId: z.enum(['happyhorse', 'grok', 'minimax', 'seedance', 'kling', 'veo', 'sora']),
  model: z.string().trim().min(1).max(200).optional(),
  aspectRatio: mediaAspectRatioSchema.optional(),
  durationSeconds: z.number().int().min(5).max(20).optional(),
  resolution: z.enum(['720p', '1080p']).optional(),
}).strict();

export const classroomMediaPlanningConfigSchema = z.object({
  image: classroomImageGenerationConfigSchema.optional(),
  video: classroomVideoGenerationConfigSchema.optional(),
}).strict().refine((value) => Boolean(value.image || value.video), 'At least one media capability is required');

export const createClassroomGenerationRunSchema = z.object({
  requirements: z.string().trim().min(1).max(20_000),
  context: z.object({
    sourceText: z.string().trim().max(100_000).optional(),
  }).strict().default({}),
  media: classroomMediaPlanningConfigSchema.optional(),
}).strict();

export const classroomGenerationRunParamsSchema = z.object({
  runId: z.string().uuid(),
});

export const createClassroomMediaTasksRunSchema = z.object({
  tts: z.object({
    providerId: z.enum(['openai', 'qwen', 'azure', 'minimax', 'elevenlabs', 'glm', 'lemonade', 'doubao', 'voxcpm']),
    voice: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(200).optional(),
    format: z.enum(['mp3', 'opus', 'wav', 'aac', 'flac', 'pcm']).optional(),
  }).strict().optional(),
}).strict();

const imageGenerationRequestSchema = z.object({
  type: z.literal('image'),
  prompt: z.string().trim().min(1).max(32_000),
  elementId: z.string().regex(/^gen_img_[a-zA-Z0-9_-]+$/).max(120),
  aspectRatio: mediaAspectRatioSchema.optional(),
  style: z.string().trim().min(1).max(2_000).optional(),
}).strict();

const videoGenerationRequestSchema = z.object({
  type: z.literal('video'),
  prompt: z.string().trim().min(1).max(32_000),
  elementId: z.string().regex(/^gen_vid_[a-zA-Z0-9_-]+$/).max(120),
  aspectRatio: mediaAspectRatioSchema.optional(),
  style: z.string().trim().min(1).max(2_000).optional(),
}).strict();

export const classroomMediaGenerationRequestSchema = z.discriminatedUnion('type', [
  imageGenerationRequestSchema,
  videoGenerationRequestSchema,
]);

const sceneOutlineSchema = z.object({
  id: z.string().trim().min(1).max(120),
  type: z.enum(['slide', 'quiz', 'interactive', 'pbl']),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().min(1).max(4_000),
  keyPoints: z.array(z.string().trim().min(1).max(2_000)).min(1).max(20),
  order: z.number().int().positive(),
  teachingObjective: z.string().max(2_000).optional(),
  estimatedDuration: z.number().int().positive().max(7_200).optional(),
  languageNote: z.string().max(2_000).optional(),
  suggestedImageIds: z.array(z.string().max(240)).max(50).optional(),
  mediaGenerations: z.array(classroomMediaGenerationRequestSchema).max(20).optional(),
  quizConfig: z.object({
    questionCount: z.number().int().positive().max(20),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    questionTypes: z.array(z.enum(['single', 'multiple', 'text'])).min(1),
  }).optional(),
  interactiveConfig: z.record(z.string(), z.unknown()).optional(),
  pblConfig: z.record(z.string(), z.unknown()).optional(),
  widgetType: z.enum(['simulation', 'diagram', 'code', 'game', 'visualization3d']).optional(),
  widgetOutline: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export const classroomOutlineSchema = z.object({
  languageDirective: z.string().trim().min(1).max(2_000),
  courseTitle: z.string().trim().min(1).max(120),
  outlines: z.array(sceneOutlineSchema).min(1).max(120),
}).strict().superRefine((value, context) => {
  const ids = new Set<string>();
  const mediaElementIds = new Set<string>();
  for (const [index, outline] of value.outlines.entries()) {
    if (ids.has(outline.id)) context.addIssue({ code: 'custom', path: ['outlines', index, 'id'], message: 'Scene IDs must be unique' });
    ids.add(outline.id);
    if (outline.order !== index + 1) context.addIssue({ code: 'custom', path: ['outlines', index, 'order'], message: 'Scene order must be sequential' });
    if (outline.type === 'quiz' && !outline.quizConfig) context.addIssue({ code: 'custom', path: ['outlines', index, 'quizConfig'], message: 'Quiz outline requires quizConfig' });
    if (outline.type === 'interactive' && (!outline.widgetType || !outline.widgetOutline) && !outline.interactiveConfig) context.addIssue({ code: 'custom', path: ['outlines', index], message: 'Interactive outline requires widget configuration' });
    if (outline.type === 'pbl' && !outline.pblConfig) context.addIssue({ code: 'custom', path: ['outlines', index, 'pblConfig'], message: 'PBL outline requires pblConfig' });
    if (outline.type !== 'slide' && outline.mediaGenerations?.length) {
      context.addIssue({ code: 'custom', path: ['outlines', index, 'mediaGenerations'], message: 'Only slide outlines may request generated media' });
    }
    for (const [mediaIndex, request] of (outline.mediaGenerations ?? []).entries()) {
      if (mediaElementIds.has(request.elementId)) {
        context.addIssue({ code: 'custom', path: ['outlines', index, 'mediaGenerations', mediaIndex, 'elementId'], message: 'Generated media element IDs must be unique across the course' });
      }
      mediaElementIds.add(request.elementId);
    }
  }
});

export const generatedSlideElementTypes = ['text', 'shape', 'line', 'chart', 'latex', 'table', 'image', 'video'] as const;

export const slideGenerationResultSchema = z.object({
  background: z.unknown().optional(),
  elements: z.array(z.object({
    id: z.string().trim().min(1),
    type: z.enum(generatedSlideElementTypes),
  }).passthrough()).max(200),
  remark: z.string().max(10_000).optional(),
}).passthrough();

export const quizGenerationResultSchema = z.array(z.object({
  id: z.string().trim().min(1).optional(),
  type: z.enum(['single', 'multiple', 'short_answer', 'text']),
  question: z.string().trim().min(1).max(10_000),
  options: z.array(z.unknown()).max(20).optional(),
  answer: z.union([z.string(), z.array(z.string())]).optional(),
  correctAnswer: z.union([z.string(), z.array(z.string())]).optional(),
  correct_answer: z.union([z.string(), z.array(z.string())]).optional(),
  analysis: z.string().max(20_000).optional(),
  explanation: z.string().max(20_000).optional(),
  commentPrompt: z.string().max(20_000).optional(),
  points: z.number().finite().positive().max(10_000).optional(),
}).passthrough()).min(1).max(20);

export type CreateClassroomGenerationRunInput = z.infer<typeof createClassroomGenerationRunSchema>;
export type CreateClassroomMediaTasksRunInput = z.infer<typeof createClassroomMediaTasksRunSchema>;
export type ClassroomMediaPlanningConfig = z.infer<typeof classroomMediaPlanningConfigSchema>;
export type ClassroomDraftContext = {
  sourceText?: string;
  media?: ClassroomMediaPlanningConfig;
};
export type ClassroomOutline = z.infer<typeof classroomOutlineSchema>;
