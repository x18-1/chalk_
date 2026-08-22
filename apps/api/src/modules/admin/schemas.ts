import { z } from 'zod';

export const usersQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  role: z.enum(['admin', 'user']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type UsersQuery = z.infer<typeof usersQuerySchema>;
