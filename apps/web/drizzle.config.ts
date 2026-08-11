import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: ['./src/lib/server/db/schema/auth.ts', './src/lib/server/db/schema/business.ts'],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
