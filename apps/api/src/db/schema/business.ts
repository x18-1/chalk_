import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
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
    baseUrl: text('base_url'),
    settings: jsonb('settings'),
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

export const agentSettings = pgTable(
  'agent_settings',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    defaultProviderId: text('default_provider_id'),
    defaultModelId: text('default_model_id'),
    defaultThinkingLevel: text('default_thinking_level').default('off').notNull(),
    defaultImageProviderId: text('default_image_provider_id'),
    defaultImageModelId: text('default_image_model_id'),
    defaultVideoProviderId: text('default_video_provider_id'),
    defaultVideoModelId: text('default_video_model_id'),
    defaultVideoDurationSeconds: integer('default_video_duration_seconds').default(5).notNull(),
    defaultVideoResolution: text('default_video_resolution').default('720p').notNull(),
    speechAdapter: text('speech_adapter').default('browser').notNull(),
    speechLanguage: text('speech_language').default('zh-CN').notNull(),
    speechVoiceUri: text('speech_voice_uri'),
    speechRate: doublePrecision('speech_rate').default(0.95).notNull(),
    speechVolume: doublePrecision('speech_volume').default(1).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('agent_settings_image_selection_check', sql`${table.defaultImageProviderId} IS NOT NULL OR ${table.defaultImageModelId} IS NULL`),
    check('agent_settings_video_selection_check', sql`${table.defaultVideoProviderId} IS NOT NULL OR ${table.defaultVideoModelId} IS NULL`),
    check('agent_settings_video_duration_check', sql`${table.defaultVideoDurationSeconds} BETWEEN 5 AND 20`),
    check('agent_settings_video_resolution_check', sql`${table.defaultVideoResolution} IN ('720p', '1080p')`),
    check('agent_settings_speech_adapter_check', sql`${table.speechAdapter} = 'browser'`),
    check('agent_settings_speech_rate_check', sql`${table.speechRate} BETWEEN 0.5 AND 2`),
    check('agent_settings_speech_volume_check', sql`${table.speechVolume} BETWEEN 0 AND 1`),
  ],
);

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

export const classrooms = pgTable(
  'classrooms',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    sourceKey: text('source_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('classrooms_id_user_unique').on(table.id, table.userId),
    unique('classrooms_user_source_unique').on(table.userId, table.sourceKey),
    index('classrooms_user_updated_idx').on(table.userId, table.updatedAt),
  ],
);

export const classroomArtifacts = pgTable(
  'classroom_artifacts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    classroomId: uuid('classroom_id').notNull(),
    userId: uuid('user_id').notNull(),
    version: integer('version').notNull(),
    document: jsonb('document'),
    contentObjectKey: text('content_object_key').unique(),
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.classroomId, table.userId],
      foreignColumns: [classrooms.id, classrooms.userId],
      name: 'classroom_artifacts_owned_classroom_fk',
    }).onDelete('cascade'),
    unique('classroom_artifacts_classroom_version_unique').on(table.classroomId, table.version),
    unique('classroom_artifacts_classroom_hash_unique').on(table.classroomId, table.contentHash),
    unique('classroom_artifacts_owned_id_unique').on(table.id, table.classroomId, table.userId),
    check(
      'classroom_artifacts_document_or_legacy_object_check',
      sql`${table.document} is not null or ${table.contentObjectKey} is not null`,
    ),
    index('classroom_artifacts_user_classroom_idx').on(table.userId, table.classroomId),
  ],
);

export const classroomArtifactMedia = pgTable(
  'classroom_artifact_media',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    artifactId: uuid('artifact_id').notNull(),
    classroomId: uuid('classroom_id').notNull(),
    userId: uuid('user_id').notNull(),
    path: text('path').notNull(),
    objectKey: text('object_key').notNull().unique(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.artifactId, table.classroomId, table.userId],
      foreignColumns: [classroomArtifacts.id, classroomArtifacts.classroomId, classroomArtifacts.userId],
      name: 'classroom_artifact_media_owned_artifact_fk',
    }).onDelete('cascade'),
    unique('classroom_artifact_media_artifact_path_unique').on(table.artifactId, table.path),
    index('classroom_artifact_media_user_artifact_idx').on(table.userId, table.artifactId),
  ],
);

export const classroomLearningSessions = pgTable(
  'classroom_learning_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    classroomId: uuid('classroom_id').notNull(),
    artifactId: uuid('artifact_id').notNull(),
    userId: uuid('user_id').notNull(),
    cursorVersion: integer('cursor_version').default(1).notNull(),
    stageId: text('stage_id').notNull(),
    sceneId: text('scene_id'),
    sceneIndex: integer('scene_index').default(0).notNull(),
    actionIndex: integer('action_index').default(0).notNull(),
    mode: text('mode').default('idle').notNull(),
    completed: boolean('completed').default(false).notNull(),
    revision: integer('revision').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.artifactId, table.classroomId, table.userId],
      foreignColumns: [classroomArtifacts.id, classroomArtifacts.classroomId, classroomArtifacts.userId],
      name: 'classroom_learning_sessions_owned_artifact_fk',
    }).onDelete('cascade'),
    unique('classroom_learning_sessions_id_user_unique').on(table.id, table.userId),
    unique('classroom_learning_sessions_owned_artifact_unique').on(
      table.id,
      table.artifactId,
      table.classroomId,
      table.userId,
    ),
    unique('classroom_learning_sessions_user_artifact_unique').on(table.userId, table.artifactId),
    check('classroom_learning_sessions_cursor_version_check', sql`${table.cursorVersion} = 1`),
    check('classroom_learning_sessions_scene_index_check', sql`${table.sceneIndex} >= 0`),
    check('classroom_learning_sessions_action_index_check', sql`${table.actionIndex} >= 0`),
    check(
      'classroom_learning_sessions_mode_check',
      sql`${table.mode} in ('idle', 'playing', 'paused', 'completed')`,
    ),
    check('classroom_learning_sessions_revision_check', sql`${table.revision} > 0`),
    index('classroom_learning_sessions_user_updated_idx').on(table.userId, table.updatedAt),
  ],
);

export const classroomQuizAttempts = pgTable(
  'classroom_quiz_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    learningSessionId: uuid('learning_session_id').notNull(),
    classroomId: uuid('classroom_id').notNull(),
    artifactId: uuid('artifact_id').notNull(),
    userId: uuid('user_id').notNull(),
    sceneId: text('scene_id').notNull(),
    answers: jsonb('answers').notNull(),
    results: jsonb('results').notNull(),
    score: integer('score').notNull(),
    maxScore: integer('max_score').notNull(),
    revision: integer('revision').default(1).notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [
        table.learningSessionId,
        table.artifactId,
        table.classroomId,
        table.userId,
      ],
      foreignColumns: [
        classroomLearningSessions.id,
        classroomLearningSessions.artifactId,
        classroomLearningSessions.classroomId,
        classroomLearningSessions.userId,
      ],
      name: 'classroom_quiz_attempts_owned_session_artifact_fk',
    }).onDelete('cascade'),
    unique('classroom_quiz_attempts_id_user_unique').on(table.id, table.userId),
    unique('classroom_quiz_attempts_session_scene_unique').on(table.learningSessionId, table.sceneId),
    check('classroom_quiz_attempts_score_check', sql`${table.score} >= 0`),
    check('classroom_quiz_attempts_max_score_check', sql`${table.maxScore} >= 0`),
    check('classroom_quiz_attempts_revision_check', sql`${table.revision} > 0`),
    index('classroom_quiz_attempts_user_session_idx').on(table.userId, table.learningSessionId),
  ],
);

export const classroomDrafts = pgTable(
  'classroom_drafts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    requirements: text('requirements').notNull(),
    context: jsonb('context').notNull(),
    outline: jsonb('outline'),
    status: text('status').default('generating').notNull(),
    publicationToken: uuid('publication_token'),
    publicationStartedAt: timestamp('publication_started_at', { withTimezone: true }),
    classroomId: uuid('classroom_id'),
    artifactId: uuid('artifact_id'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.classroomId, table.userId],
      foreignColumns: [classrooms.id, classrooms.userId],
      name: 'classroom_drafts_owned_classroom_fk',
    }),
    foreignKey({
      columns: [table.artifactId, table.classroomId, table.userId],
      foreignColumns: [classroomArtifacts.id, classroomArtifacts.classroomId, classroomArtifacts.userId],
      name: 'classroom_drafts_owned_artifact_fk',
    }),
    check(
      'classroom_drafts_publication_check',
      sql`(${table.classroomId} is null and ${table.artifactId} is null and ${table.publishedAt} is null) or (${table.classroomId} is not null and ${table.artifactId} is null and ${table.publishedAt} is null) or (${table.classroomId} is not null and ${table.artifactId} is not null and ${table.publishedAt} is not null)`,
    ),
    check(
      'classroom_drafts_publication_reservation_check',
      sql`(${table.publicationToken} is null and ${table.publicationStartedAt} is null) or (${table.publicationToken} is not null and ${table.publicationStartedAt} is not null)`,
    ),
    unique('classroom_drafts_id_user_unique').on(table.id, table.userId),
    unique('classroom_drafts_artifact_unique').on(table.artifactId),
    index('classroom_drafts_user_updated_idx').on(table.userId, table.updatedAt),
  ],
);

export const classroomOutlineRevisions = pgTable(
  'classroom_outline_revisions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    draftId: uuid('draft_id').notNull(),
    userId: uuid('user_id').notNull(),
    number: integer('number').notNull(),
    idempotencyKey: uuid('idempotency_key').notNull(),
    outline: jsonb('outline').notNull(),
    contentHash: text('content_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.draftId, table.userId],
      foreignColumns: [classroomDrafts.id, classroomDrafts.userId],
      name: 'classroom_outline_revisions_owned_draft_fk',
    }).onDelete('cascade'),
    unique('classroom_outline_revisions_owned_id_unique').on(table.id, table.draftId, table.userId),
    unique('classroom_outline_revisions_draft_number_unique').on(table.draftId, table.number),
    unique('classroom_outline_revisions_draft_idempotency_unique').on(table.draftId, table.idempotencyKey),
    index('classroom_outline_revisions_user_draft_idx').on(table.userId, table.draftId, table.number),
  ],
);

export const classroomDraftScenes = pgTable(
  'classroom_draft_scenes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    draftId: uuid('draft_id').notNull(),
    userId: uuid('user_id').notNull(),
    outlineRevisionId: uuid('outline_revision_id'),
    outlineId: text('outline_id').notNull(),
    type: text('type').notNull(),
    order: integer('order').notNull(),
    outline: jsonb('outline').notNull(),
    content: jsonb('content'),
    actions: jsonb('actions'),
    status: text('status').default('pending').notNull(),
    attempt: integer('attempt').default(0).notNull(),
    promptId: text('prompt_id'),
    promptRevision: text('prompt_revision'),
    modelProviderId: text('model_provider_id'),
    modelId: text('model_id'),
    errorCode: text('error_code'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    actionStatus: text('action_status').default('pending').notNull(),
    actionAttempt: integer('action_attempt').default(0).notNull(),
    actionPromptId: text('action_prompt_id'),
    actionPromptRevision: text('action_prompt_revision'),
    actionModelProviderId: text('action_model_provider_id'),
    actionModelId: text('action_model_id'),
    actionErrorCode: text('action_error_code'),
    actionStartedAt: timestamp('action_started_at', { withTimezone: true }),
    actionFinishedAt: timestamp('action_finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.draftId, table.userId],
      foreignColumns: [classroomDrafts.id, classroomDrafts.userId],
      name: 'classroom_draft_scenes_owned_draft_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.outlineRevisionId, table.draftId, table.userId],
      foreignColumns: [classroomOutlineRevisions.id, classroomOutlineRevisions.draftId, classroomOutlineRevisions.userId],
      name: 'classroom_draft_scenes_owned_outline_revision_fk',
    }).onDelete('cascade'),
    unique('classroom_draft_scenes_id_user_unique').on(table.id, table.userId),
    unique('classroom_draft_scenes_draft_outline_unique').on(table.draftId, table.outlineId),
    unique('classroom_draft_scenes_draft_order_unique').on(table.draftId, table.order),
    index('classroom_draft_scenes_user_draft_idx').on(table.userId, table.draftId, table.order),
  ],
);

export const classroomGenerationRuns = pgTable(
  'classroom_generation_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    draftId: uuid('draft_id').notNull(),
    userId: uuid('user_id').notNull(),
    outlineRevisionId: uuid('outline_revision_id'),
    stage: text('stage').default('outline').notNull(),
    status: text('status').default('queued').notNull(),
    attempt: integer('attempt').default(1).notNull(),
    promptId: text('prompt_id'),
    promptRevision: text('prompt_revision'),
    modelProviderId: text('model_provider_id'),
    modelId: text('model_id'),
    errorCode: text('error_code'),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.draftId, table.userId],
      foreignColumns: [classroomDrafts.id, classroomDrafts.userId],
      name: 'classroom_generation_runs_owned_draft_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.outlineRevisionId, table.draftId, table.userId],
      foreignColumns: [classroomOutlineRevisions.id, classroomOutlineRevisions.draftId, classroomOutlineRevisions.userId],
      name: 'classroom_generation_runs_owned_outline_revision_fk',
    }).onDelete('cascade'),
    unique('classroom_generation_runs_id_user_unique').on(table.id, table.userId),
    unique('classroom_generation_runs_draft_stage_unique').on(table.draftId, table.stage),
    index('classroom_generation_runs_user_updated_idx').on(table.userId, table.updatedAt),
    index('classroom_generation_runs_claim_idx').on(table.status, table.leaseExpiresAt, table.createdAt),
  ],
);

export const classroomOutlineEvents = pgTable(
  'classroom_outline_events',
  {
    id: serial('id').primaryKey(),
    runId: uuid('run_id').notNull(),
    userId: uuid('user_id').notNull(),
    eventOrder: integer('event_order').notNull(),
    type: text('type').notNull(),
    data: jsonb('data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.runId, table.userId],
      foreignColumns: [classroomGenerationRuns.id, classroomGenerationRuns.userId],
      name: 'classroom_outline_events_owned_run_fk',
    }).onDelete('cascade'),
    unique('classroom_outline_events_run_order_unique').on(table.runId, table.eventOrder),
    index('classroom_outline_events_user_run_id_idx').on(table.userId, table.runId, table.id),
  ],
);

export const classroomDraftMediaTasks = pgTable(
  'classroom_draft_media_tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    runId: uuid('run_id').notNull(),
    draftId: uuid('draft_id').notNull(),
    sceneId: uuid('scene_id').notNull(),
    userId: uuid('user_id').notNull(),
    actionId: text('action_id'),
    elementId: text('element_id'),
    taskKey: text('task_key').notNull(),
    taskOrder: integer('task_order').notNull(),
    kind: text('kind').notNull(),
    input: jsonb('input').notNull(),
    status: text('status').default('pending').notNull(),
    attempt: integer('attempt').default(0).notNull(),
    providerId: text('provider_id'),
    modelId: text('model_id'),
    providerTaskId: text('provider_task_id'),
    mediaRef: text('media_ref'),
    objectKey: text('object_key').unique(),
    contentType: text('content_type'),
    size: integer('size'),
    contentHash: text('content_hash'),
    errorCode: text('error_code'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.runId, table.userId],
      foreignColumns: [classroomGenerationRuns.id, classroomGenerationRuns.userId],
      name: 'classroom_draft_media_tasks_owned_run_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.sceneId, table.userId],
      foreignColumns: [classroomDraftScenes.id, classroomDraftScenes.userId],
      name: 'classroom_draft_media_tasks_owned_scene_fk',
    }).onDelete('cascade'),
    check(
      'classroom_draft_media_tasks_source_check',
      sql`(${table.kind} = 'audio' AND ${table.actionId} IS NOT NULL AND ${table.elementId} IS NULL) OR (${table.kind} IN ('image', 'video') AND ${table.actionId} IS NULL AND ${table.elementId} IS NOT NULL)`,
    ),
    unique('classroom_draft_media_tasks_draft_key_unique').on(table.draftId, table.taskKey),
    index('classroom_draft_media_tasks_user_run_idx').on(table.userId, table.runId, table.taskOrder),
  ],
);

export const classroomDiscussionSessions = pgTable(
  'classroom_discussion_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    learningSessionId: uuid('learning_session_id'),
    generationRunId: uuid('generation_run_id'),
    sceneId: text('scene_id').notNull(),
    topic: text('topic').notNull(),
    prompt: text('prompt'),
    triggerAgentId: text('trigger_agent_id'),
    participants: jsonb('participants').notNull(),
    entryCursor: jsonb('entry_cursor').notNull(),
    status: text('status').default('active').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.learningSessionId, table.userId],
      foreignColumns: [classroomLearningSessions.id, classroomLearningSessions.userId],
      name: 'classroom_discussion_sessions_owned_learning_session_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.generationRunId, table.userId],
      foreignColumns: [classroomGenerationRuns.id, classroomGenerationRuns.userId],
      name: 'classroom_discussion_sessions_owned_generation_run_fk',
    }).onDelete('cascade'),
    unique('classroom_discussion_sessions_id_user_unique').on(table.id, table.userId),
    check(
      'classroom_discussion_sessions_target_check',
      sql`(${table.learningSessionId} is not null and ${table.generationRunId} is null) or (${table.learningSessionId} is null and ${table.generationRunId} is not null)`,
    ),
    check(
      'classroom_discussion_sessions_status_check',
      sql`${table.status} in ('active', 'completed', 'aborted', 'failed')`,
    ),
    index('classroom_discussion_sessions_learning_scene_idx').on(
      table.userId,
      table.learningSessionId,
      table.sceneId,
      table.updatedAt,
    ),
    index('classroom_discussion_sessions_generation_scene_idx').on(
      table.userId,
      table.generationRunId,
      table.sceneId,
      table.updatedAt,
    ),
  ],
);

export const classroomDiscussionRounds = pgTable(
  'classroom_discussion_rounds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    discussionId: uuid('discussion_id').notNull(),
    userId: uuid('user_id').notNull(),
    status: text('status').default('running').notNull(),
    directorPromptId: text('director_prompt_id'),
    directorPromptRevision: text('director_prompt_revision'),
    participantPromptId: text('participant_prompt_id'),
    participantPromptRevision: text('participant_prompt_revision'),
    modelProviderId: text('model_provider_id'),
    modelId: text('model_id'),
    errorCode: text('error_code'),
    leaseOwner: text('lease_owner'),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).defaultNow().notNull(),
    abortRequestedAt: timestamp('abort_requested_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      columns: [table.discussionId, table.userId],
      foreignColumns: [classroomDiscussionSessions.id, classroomDiscussionSessions.userId],
      name: 'classroom_discussion_rounds_owned_session_fk',
    }).onDelete('cascade'),
    unique('classroom_discussion_rounds_owned_id_unique').on(
      table.id,
      table.discussionId,
      table.userId,
    ),
    check(
      'classroom_discussion_rounds_status_check',
      sql`${table.status} in ('running', 'completed', 'aborted', 'failed')`,
    ),
    index('classroom_discussion_rounds_user_session_idx').on(
      table.userId,
      table.discussionId,
      table.startedAt,
    ),
  ],
);

export const classroomDiscussionMessages = pgTable(
  'classroom_discussion_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    discussionId: uuid('discussion_id').notNull(),
    roundId: uuid('round_id').notNull(),
    userId: uuid('user_id').notNull(),
    sequence: integer('sequence').notNull(),
    sender: text('sender').notNull(),
    agentId: text('agent_id'),
    agentName: text('agent_name'),
    agentRole: text('agent_role'),
    content: text('content').default('').notNull(),
    actions: jsonb('actions').default(sql`'[]'::jsonb`).notNull(),
    status: text('status').default('streaming').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.roundId, table.discussionId, table.userId],
      foreignColumns: [
        classroomDiscussionRounds.id,
        classroomDiscussionRounds.discussionId,
        classroomDiscussionRounds.userId,
      ],
      name: 'classroom_discussion_messages_owned_round_fk',
    }).onDelete('cascade'),
    unique('classroom_discussion_messages_id_user_unique').on(table.id, table.userId),
    unique('classroom_discussion_messages_session_sequence_unique').on(
      table.discussionId,
      table.sequence,
    ),
    check(
      'classroom_discussion_messages_sender_check',
      sql`${table.sender} in ('student', 'agent', 'system')`,
    ),
    check(
      'classroom_discussion_messages_status_check',
      sql`${table.status} in ('streaming', 'completed', 'interrupted')`,
    ),
    index('classroom_discussion_messages_user_session_idx').on(
      table.userId,
      table.discussionId,
      table.sequence,
    ),
  ],
);
