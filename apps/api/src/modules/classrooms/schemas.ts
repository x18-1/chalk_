import { z } from 'zod';

export const createClassroomSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(2_000).optional(),
  document: z.unknown(),
});

export const classroomArtifactParamsSchema = z.object({
  classroomId: z.string().uuid(),
  artifactId: z.string().uuid(),
});

export const classroomParamsSchema = z.object({
  classroomId: z.string().uuid(),
});

export const createArtifactSchema = z.object({
  document: z.unknown(),
});

export type CreateClassroomInput = z.infer<typeof createClassroomSchema>;
