import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { authUsers } from './auth';

export const conversations = pgTable('conversations', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  title: text('title'),
  titleSource: text('title_source').default('fallback').notNull(),
  sessionId: text('session_id').notNull(),
  sessionFilePath: text('session_file_path').notNull(),
  sessionBackend: text('session_backend').default('jsonl').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const mcpServers = pgTable('mcp_servers', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  transport: text('transport').notNull(), // "stdio" | "sse" | "http"
  command: text('command'),
  args: jsonb('args'),
  url: text('url'),
  envEnc: text('env_enc'),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const customProviders = pgTable('custom_providers', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  baseUrl: text('base_url').notNull(),
  apiKeyEnc: text('api_key_enc'),
  api: text('api').default('openai-completions').notNull(),
  modelIds: jsonb('model_ids'),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const providerCredentials = pgTable(
  'provider_credentials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    providerId: text('provider_id').notNull(),
    apiKeyEnc: text('api_key_enc'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.userId, t.providerId)],
);

export const toolApprovals = pgTable(
  'tool_approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    toolCallId: text('tool_call_id').notNull(),
    toolName: text('tool_name').notNull(),
    args: jsonb('args').notNull(),
    status: text('status').default('pending').notNull(), // pending | approved | rejected
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique().on(table.conversationId, table.toolCallId)],
);

export const agentSettings = pgTable('agent_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  defaultProviderId: text('default_provider_id'),
  defaultModelId: text('default_model_id'),
  defaultThinkingLevel: text('default_thinking_level').default('off').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const skillSettings = pgTable(
  'skill_settings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    skillName: text('skill_name').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.skillName] })],
);

export const toolSettings = pgTable(
  'tool_settings',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    approval: text('approval').default('default').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.toolName] })],
);

export const subagentRuns = pgTable('subagent_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  parentSessionId: text('parent_session_id').notNull(),
  childSessionId: text('child_session_id').notNull(),
  modelProviderId: text('model_provider_id'),
  modelId: text('model_id'),
  toolNames: jsonb('tool_names'),
  timeoutMs: integer('timeout_ms').notNull(),
  status: text('status').default('running').notNull(),
  error: text('error'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
});

export const agentRunObservations = pgTable(
  'agent_run_observations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    modelProviderId: text('model_provider_id'),
    modelId: text('model_id'),
    status: text('status').notNull(),
    durationMs: integer('duration_ms').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    totalCost: doublePrecision('total_cost'),
    errorCategory: text('error_category'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('agent_run_observations_conversation_started_idx').on(
      table.conversationId,
      table.startedAt,
    ),
    index('agent_run_observations_user_started_idx').on(
      table.userId,
      table.startedAt,
    ),
  ],
);

export const attachments = pgTable('attachments', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  conversationId: uuid('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  fileKey: text('file_key').notNull().unique(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  size: integer('size').notNull(),
  status: text('status').default('pending').notNull(),
  publicUrl: text('public_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
});
