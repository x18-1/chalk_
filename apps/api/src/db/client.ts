import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;
let _client: ReturnType<typeof postgres> | undefined;

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
    _client = postgres(url);
    _db = drizzle(_client, { schema });
  }
  return _db;
}

export type Database = ReturnType<typeof createDb>;

export async function closeDb() {
  await _client?.end({ timeout: 5 });
  _client = undefined;
  _db = undefined;
}
