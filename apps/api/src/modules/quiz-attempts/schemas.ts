import { z } from 'zod';

export const quizAttemptParamsSchema = z.object({
  sessionId: z.string().uuid(),
  sceneId: z.string().min(1).max(240),
});

export const quizAttemptSessionParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

export const saveQuizAttemptSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  answers: z.record(
    z.string().min(1).max(240),
    z.array(z.string().max(10_000)).min(1).max(100),
  ).refine((answers) => Object.keys(answers).length <= 1_000, 'Too many quiz answers'),
});

export type SaveQuizAttemptInput = z.infer<typeof saveQuizAttemptSchema>;
