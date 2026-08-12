import { z } from 'zod';

export const httpUrlSchema = z.string().url().superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    context.addIssue({ code: 'custom', message: 'URL must use HTTP or HTTPS' });
  }
  if (url.username || url.password) {
    context.addIssue({ code: 'custom', message: 'URL must not contain credentials' });
  }
});

export const envSchema = z.record(z.string().trim().min(1).max(500), z.string().max(10_000));
