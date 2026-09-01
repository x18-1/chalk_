import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { authUsers } from './auth';

export const memoryEvents = pgTable('memory_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  surface: text('surface').notNull(), kind: text('kind').notNull(), payload: jsonb('payload').notNull(),
  sourceType: text('source_type'), sourceId: text('source_id'), fingerprint: text('fingerprint'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('memory_events_user_surface_occurred_idx').on(table.userId, table.surface, table.occurredAt),
  unique('memory_events_user_fingerprint_unique').on(table.userId, table.fingerprint),
  check('memory_events_surface_check', sql`${table.surface} <> ''`),
  check('memory_events_kind_check', sql`${table.kind} <> ''`),
]);

export const memoryEntries = pgTable('memory_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  layer: text('layer').notNull(), surface: text('surface'), slot: text('slot'),
  section: text('section').notNull(), text: text('text').notNull(),
  refs: jsonb('refs').$type<string[]>().notNull().default([]),
  status: text('status').notNull().default('active'), version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('memory_entries_user_layer_scope_idx').on(table.userId, table.layer, table.surface, table.slot, table.updatedAt),
  check('memory_entries_layer_check', sql`${table.layer} in ('L2', 'L3')`),
  check('memory_entries_scope_check', sql`(${table.layer} = 'L2' and ${table.surface} is not null and ${table.slot} is null) or (${table.layer} = 'L3' and ${table.surface} is null and ${table.slot} is not null)`),
  check('memory_entries_text_check', sql`length(trim(${table.text})) > 0`),
  check('memory_entries_status_check', sql`${table.status} in ('active', 'archived')`),
]);

export const memoryCursors = pgTable('memory_cursors', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  layer: text('layer').notNull(), key: text('key').notNull(),
  seenRefs: jsonb('seen_refs').$type<string[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('memory_cursors_user_layer_key_unique').on(table.userId, table.layer, table.key),
  check('memory_cursors_layer_check', sql`${table.layer} in ('L2', 'L3')`),
  check('memory_cursors_key_check', sql`${table.key} <> ''`),
]);

export const memoryConsolidationRuns = pgTable('memory_consolidation_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull().references(() => authUsers.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('queued'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  error: text('error'),
}, (table) => [
  index('memory_consolidation_runs_user_status_idx').on(table.userId, table.status, table.requestedAt),
  check('memory_consolidation_runs_status_check', sql`${table.status} in ('queued', 'running', 'completed', 'failed')`),
]);
