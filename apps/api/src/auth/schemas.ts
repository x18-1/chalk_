import { z } from 'zod';

export const credentialsSchema = z.object({
  email: z.string().trim().min(1).max(320).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(1_000),
});
