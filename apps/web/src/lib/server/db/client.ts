import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function createDb(connectionString: string) {
  const client = postgres(connectionString);
  return drizzle(client, { schema });
}

export function getDb() {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error('DATABASE_URL is not set');
    }
    _db = createDb(url);
  }
  return _db;
}

export type Database = ReturnType<typeof createDb>;
