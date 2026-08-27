import { z } from 'zod';
import { CursorSnapshotSchema } from '@chalk/chalkboard';

export const learningSessionArtifactParamsSchema = z.object({
  classroomId: z.string().uuid(),
  artifactId: z.string().uuid(),
});

export const learningSessionParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

export const savePlaybackCursorSchema = z.object({
  expectedRevision: z.number().int().positive(),
  cursor: CursorSnapshotSchema,
});
