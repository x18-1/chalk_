import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['./src/db/schema/auth.ts', './src/db/schema/business.ts', './src/db/schema/memory.ts'],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
