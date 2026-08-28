import { CursorSnapshotSchema } from '@chalk/chalkboard';
import { z } from 'zod';

const discussionTargetKindSchema = z.enum(['learning_session', 'generation_run']);

export const createClassroomDiscussionSchema = z.object({
  kind: discussionTargetKindSchema,
  id: z.string().uuid(),
  sceneId: z.string().min(1).max(200),
  topic: z.string().trim().min(1).max(500),
  prompt: z.string().trim().min(1).max(2_000).optional(),
  triggerAgentId: z.string().trim().min(1).max(200).optional(),
  entryCursor: CursorSnapshotSchema.optional(),
}).superRefine((value, context) => {
  if (value.kind === 'generation_run' && !value.entryCursor) {
    context.addIssue({
      code: 'custom',
      path: ['entryCursor'],
      message: 'Draft classroom discussions require an entry cursor',
    });
  }
});

export const currentClassroomDiscussionSchema = z.object({
  kind: discussionTargetKindSchema,
  id: z.string().uuid(),
  sceneId: z.string().min(1).max(200),
});

export const classroomDiscussionParamsSchema = z.object({
  id: z.string().uuid(),
});

export const classroomDiscussionRoundSchema = z.object({
  message: z.string().trim().min(1).max(2_000).optional(),
});
