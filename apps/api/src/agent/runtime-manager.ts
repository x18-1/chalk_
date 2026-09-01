import { resolve, sep } from 'node:path';
import { realpath } from 'node:fs/promises';

import { eq } from 'drizzle-orm';
import {
  AgentRuntime,
  createAgentRuntime,
  createJsonlSessionRepository,
  McpManager,
  createRuntimeTelemetryContext,
  ForegroundSubagentExecutor,
  createSubagentTool,
  createReadSkillTool,
  SkillRegistry,
  type ApprovalPort,
  type ToolApprovalDecision,
  type RuntimeSession,
  type ToolApprovalMode,
  ToolErrorChannel,
} from '@chalk/agent-runtime';

import { getDb } from '../db/client';
import { authUsers } from '../db/schema';
import {
  createAgentSettingsDal,
  createAgentRunObservationsDal,
  createConversationsDal,
  createCustomProvidersDal,
  createMcpServersDal,
  createSubagentRunsDal,
  createSkillSettingsDal,
  createToolApprovalsDal,
  createToolSettingsDal,
} from '../db/dal';
import { decrypt } from '../security/credential-encryption';
import { createBuiltinToolRegistry, type KnowledgeBaseQueryer } from './builtin-tools';
import { knowledgeBaseSearchToolSummary } from './tools/knowledge-base-search';
import { createUploadedFileResourceAdapterFromDatabase } from './tools/read/uploaded-file-reader';
import { createMcpResourceAdapter } from './tools/read/mcp-resource-reader';
import { createResourceReader } from './tools/read/read-resource';
import { runtimeTelemetry } from './telemetry';
import { ToolApprovalAlreadyDecidedError, ToolApprovalNotActiveError } from '../db/errors';
import {
  createModelCatalog,
  parseModelThinkingLevel,
  type CustomOpenAiModel,
  type ModelSelection,
} from '../providers/llm/model-catalog';
import { DrizzleCredentialStore } from '../providers/llm/credential-store';
import { PROMPT_IDS, buildPrompt } from '../prompts';

let sessionRepository: ReturnType<typeof createJsonlSessionRepository> | undefined;

function getSessionRepository() {
  if (!sessionRepository) {
    sessionRepository = createJsonlSessionRepository({
      cwd: process.cwd(),
      sessionsRoot: resolve(
        process.cwd(),
        process.env.SESSIONS_ROOT ?? '../../data/sessions',
      ),
    });
  }
  return sessionRepository;
}

async function canUseStdioMcp(userId: string) {
  const rows = await getDb()
    .select({ role: authUsers.role })
    .from(authUsers)
    .where(eq(authUsers.id, userId))
    .limit(1);
  return rows[0]?.role === 'admin';
}

type PendingApproval = {
  resolve: (decision: ToolApprovalDecision) => void;
  reject: (error: Error) => void;
};

type AgentRuntimeConfig = {
  toolApprovalTimeoutMs: number;
};

let runtimeConfig: AgentRuntimeConfig = {
  toolApprovalTimeoutMs: 120_000,
};

export function configureAgentRuntime(config: AgentRuntimeConfig) {
  runtimeConfig = config;
}

class ApprovalBroker implements ApprovalPort {
  private readonly pending = new Map<string, PendingApproval>();

  constructor(private readonly userId: string) {}

  async request(
    request: Parameters<ApprovalPort['request']>[0],
    signal?: AbortSignal,
    onPending?: () => void,
  ): Promise<ToolApprovalDecision> {
    const conversationId = request.context.conversationId;
    if (!conversationId) {
      return { approved: false, reason: 'Approval requires a conversation context', errorCode: 'approval_rejected' };
    }

    const db = getDb();
    const approvals = createToolApprovalsDal(db);
    const row = await approvals.create(this.userId, {
      conversationId,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      args: request.args,
    });
    const key = `${conversationId}:${request.toolCallId}`;

    return new Promise<ToolApprovalDecision>((resolveDecision, rejectDecision) => {
      let settled = false;
      // The timer is assigned after cleanup is defined so an already-aborted signal stays safe.
      // eslint-disable-next-line prefer-const
      let timeout: NodeJS.Timeout | undefined;

      const cleanup = () => {
        this.pending.delete(key);
        signal?.removeEventListener('abort', abort);
        if (timeout) clearTimeout(timeout);
      };
      const resolve = (decision: ToolApprovalDecision) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolveDecision(decision);
      };
      const reject = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectDecision(error);
      };
      const abort = () => {
        void approvals
          .updateStatusByToolCall(
            this.userId,
            conversationId,
            request.toolCallId,
            'rejected',
          )
          .catch(() => undefined)
          .finally(() => reject(new Error('Tool approval was aborted')));
      };

      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(key, { resolve, reject });

      timeout = setTimeout(async () => {
        const current = this.pending.get(key);
        if (!current) return;
        try {
          await approvals.updateStatusByToolCall(
            this.userId,
            conversationId,
            request.toolCallId,
            'rejected',
          );
          current.resolve({ approved: false, reason: 'Tool approval timed out', errorCode: 'approval_timed_out' });
        } catch (error) {
          if (error instanceof ToolApprovalAlreadyDecidedError) {
            current.resolve({
              approved: error.status === 'approved',
              reason: `Tool approval was already ${error.status}`,
              ...(error.status === 'approved' ? {} : { errorCode: 'approval_rejected' as const }),
            });
            return;
          }
          current.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }, runtimeConfig.toolApprovalTimeoutMs);
      onPending?.();
      void row;
    });
  }

  async decide(conversationId: string, toolCallId: string, approved: boolean, reason?: string) {
    const pending = this.pending.get(`${conversationId}:${toolCallId}`);
    if (!pending) {
      throw new ToolApprovalNotActiveError(toolCallId);
    }

    const approvals = createToolApprovalsDal(getDb());
    try {
      await approvals.updateStatusByToolCall(
        this.userId,
        conversationId,
        toolCallId,
        approved ? 'approved' : 'rejected',
      );
    } catch (error) {
      if (error instanceof ToolApprovalAlreadyDecidedError) {
        pending.resolve({
          approved: false,
          reason: `Tool approval was already ${error.status}`,
          ...(error.status === 'approved' ? {} : { errorCode: 'approval_rejected' as const }),
        });
      }
      throw error;
    }
    pending.resolve({ approved, ...(reason ? { reason } : {}) });
  }

  rejectAll() {
    for (const [key, pending] of this.pending) {
      this.pending.delete(key);
      pending.reject(new Error('Agent runtime was closed'));
    }
  }
}

type RuntimeEntry = {
  ownerId: string;
  runtime: AgentRuntime;
  session: RuntimeSession;
  approvals: ApprovalBroker;
  mcp: McpManager;
  model: ModelSelection;
  knowledgeBaseId?: string;
};

const activeRuntimes = new Map<string, RuntimeEntry>();

async function skillSources() {
  const configuredPaths = (process.env.SKILLS_DIRS ?? '')
    .split(':')
    .map((path) => path.trim())
    .filter(Boolean);
  const builtinRoots = (await Promise.all([
    realpath(resolve(process.cwd(), 'skills')).catch(() => undefined),
    realpath(resolve(process.cwd(), 'apps/api/skills')).catch(() => undefined),
  ])).filter((root): root is string => Boolean(root));
  return Promise.all(configuredPaths.map(async (path, index) => {
    const canonicalPath = await realpath(resolve(process.cwd(), path)).catch(() => resolve(process.cwd(), path));
    const trusted = builtinRoots.some((root) => canonicalPath === root || canonicalPath.startsWith(`${root}${sep}`));
    return {
      id: `configured-${index}`,
      label: `配置来源 ${index + 1}`,
      path: canonicalPath,
      trusted,
    };
  }));
}

async function createCatalog(userId: string) {
  const db = getDb();
  const credentials = new DrizzleCredentialStore(db, userId);
  const customProviders = await createCustomProvidersDal(db).list(userId);
  return createModelCatalog({
    credentials,
    customProviders: customProviders
      .filter((provider) => provider.enabled)
      .map((provider) => ({
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        models: parseCustomModels(provider.modelIds),
        ...(provider.apiKeyEnc ? { apiKey: decrypt(provider.apiKeyEnc) } : {}),
      })),
  });
}

function parseCustomModels(value: unknown): CustomOpenAiModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((model) => {
    if (typeof model === 'string') {
      return [{ id: model, name: model, reasoning: false, input: ['text', 'image'], contextWindow: 128_000, maxTokens: 8_192, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }];
    }
    if (!model || typeof model !== 'object') return [];
    const candidate = model as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') return [];
    const cost = candidate.cost && typeof candidate.cost === 'object' ? candidate.cost as Record<string, unknown> : {};
    return [{
      id: candidate.id,
      name: candidate.name,
      reasoning: candidate.reasoning === true,
      input: (Array.isArray(candidate.input) && candidate.input.includes('image') ? ['text', 'image'] : ['text']) as ('text' | 'image')[],
      contextWindow: typeof candidate.contextWindow === 'number' ? candidate.contextWindow : 128_000,
      maxTokens: typeof candidate.maxTokens === 'number' ? candidate.maxTokens : 8_192,
      cost: {
        input: typeof cost.input === 'number' ? cost.input : 0,
        output: typeof cost.output === 'number' ? cost.output : 0,
        cacheRead: typeof cost.cacheRead === 'number' ? cost.cacheRead : 0,
        cacheWrite: typeof cost.cacheWrite === 'number' ? cost.cacheWrite : 0,
      },
    }];
  });
}

function createBuiltinTools(
  userId: string,
  mcp?: McpManager,
  readSkillTool?: ReturnType<typeof createReadSkillTool>,
  knowledgeBase?: { queryer: KnowledgeBaseQueryer; id: string },
) {
  const conversations = createConversationsDal(getDb());
  const readCursorSecret = process.env.CREDENTIAL_ENCRYPTION_KEY;
  return createBuiltinToolRegistry({
    conversationTitleUpdater: {
      async update(input) {
        const row = await conversations.update(input.ownerId, input.conversationId, {
          title: input.title,
          titleSource: 'manual',
        });
        return { title: row.title ?? input.title };
      },
    },
    ...(readCursorSecret
      ? {
        readResourceReader: createResourceReader([
          createUploadedFileResourceAdapterFromDatabase(getDb()),
          ...(mcp ? [createMcpResourceAdapter(mcp)] : []),
        ]),
        readCursorSecret,
      }
      : {}),
    ...(readSkillTool ? { readSkillTool } : {}),
    ...(knowledgeBase
      ? { knowledgeBaseQueryer: knowledgeBase.queryer, knowledgeBaseId: knowledgeBase.id, ownerId: userId }
      : {}),
  });
}

export async function selectModel(
  userId: string,
  requested?: ModelSelection,
): Promise<{ catalog: Awaited<ReturnType<typeof createCatalog>>; model: ModelSelection }> {
  const catalog = await createCatalog(userId);
  if (requested) return { catalog, model: requested };

  const settings = await createAgentSettingsDal(getDb()).get(userId);
  if (settings?.defaultProviderId && settings.defaultModelId) {
    return {
      catalog,
      model: {
        providerId: settings.defaultProviderId,
        modelId: settings.defaultModelId,
        thinkingLevel: parseModelThinkingLevel(settings.defaultThinkingLevel),
      },
    };
  }

  const available = await catalog.getAvailableModels();
  const preferred = available.find(
    (model) => model.providerId === 'deepseek' && model.id === 'deepseek-v4-flash',
  ) ?? available[0];
  if (!preferred) throw new Error('No configured model is available');
  return {
    catalog,
    model: { providerId: preferred.providerId, modelId: preferred.id, thinkingLevel: 'off' },
  };
}

export async function createUserModelCatalog(userId: string) {
  return createCatalog(userId);
}

export async function loadUserSkills(userId: string) {
  if (!userId) throw new Error('Skills require an authenticated user');
  const skills = new SkillRegistry(process.cwd(), await skillSources());
  const snapshot = await skills.reload();
  const settings = await createSkillSettingsDal(getDb()).list(userId);
  const overrides = new Map(settings.map((setting) => [setting.skillName, setting.enabled]));
  const enabledSkillNames = new Set(
    snapshot.skills
      .filter((skill) => overrides.get(skill.name) ?? true)
      .map((skill) => skill.name),
  );
  return { registry: skills, snapshot, enabledSkillNames };
}

export async function getOrCreateRuntime(
  userId: string,
  conversation: { id: string; sessionId: string; sessionFilePath?: string },
  requestedModel?: ModelSelection,
  options: { knowledgeBaseId?: string; knowledgeBaseQueryer?: KnowledgeBaseQueryer } = {},
) {
  const db = getDb();
  const settings = await createAgentSettingsDal(db).get(userId);
  const selectedModel = requestedModel ?? (
    settings?.defaultProviderId && settings.defaultModelId
      ? {
          providerId: settings.defaultProviderId,
          modelId: settings.defaultModelId,
          thinkingLevel: parseModelThinkingLevel(settings.defaultThinkingLevel),
        }
      : undefined
  );
  const existing = activeRuntimes.get(conversation.id);
  if (existing && (!selectedModel ||
    existing.model.providerId === selectedModel.providerId &&
    existing.model.modelId === selectedModel.modelId &&
    existing.model.thinkingLevel === selectedModel.thinkingLevel) &&
    existing.knowledgeBaseId === options.knowledgeBaseId) {
    return existing;
  }
  if (existing) await closeRuntime(conversation.id);

  const session = await getSessionRepository().open(
    userId,
    conversation.sessionId,
    conversation.sessionFilePath,
  );

  const { catalog, model } = await selectModel(userId, requestedModel);
  const llm = await catalog.resolveSelection(model);
  const skills = new SkillRegistry(process.cwd(), await skillSources());
  const skillSnapshot = await skills.reload();
  const skillSettings = await createSkillSettingsDal(db).list(userId);
  const skillOverrides = new Map(skillSettings.map((setting) => [setting.skillName, setting.enabled]));
  const enabledSkillNames = new Set(
    skillSnapshot.skills
      .filter((skill) => skillOverrides.get(skill.name) ?? true)
      .map((skill) => skill.name),
  );
  const approvals = new ApprovalBroker(userId);
  const mcp = new McpManager();
  const mcpRows = await createMcpServersDal(db).list(userId);
  const canUseStdio = await canUseStdioMcp(userId);
  for (const row of mcpRows.filter((server) => server.enabled && (canUseStdio || server.transport !== 'stdio'))) {
    mcp.register({
      id: row.id,
      name: row.name,
      transport: row.transport as 'stdio' | 'sse' | 'http',
      ...(row.command ? { command: row.command } : {}),
      ...(Array.isArray(row.args) ? { args: row.args.filter((arg): arg is string => typeof arg === 'string') } : {}),
      ...(row.url ? { url: row.url } : {}),
      ...(row.envEnc ? { env: JSON.parse(decrypt(row.envEnc)) as Record<string, string> } : {}),
      enabled: row.enabled,
    });
  }
  const toolSettings = await createToolSettingsDal(db).list(userId);
  const observations = createAgentRunObservationsDal(db);
  const telemetry = createRuntimeTelemetryContext(runtimeTelemetry);
  const toolErrorChannel = new ToolErrorChannel();
  const toolOverrides = new Map(toolSettings.map((setting) => [setting.toolName, setting]));
  const registry = createBuiltinTools(
    userId,
    mcp,
    createReadSkillTool(skills, enabledSkillNames),
    options.knowledgeBaseId && options.knowledgeBaseQueryer
      ? { id: options.knowledgeBaseId, queryer: options.knowledgeBaseQueryer }
      : undefined,
  );
  for (const tool of mcp.proxyTools()) registry.register(tool);

  const childExecutor = new ForegroundSubagentExecutor({
      sessions: getSessionRepository(),
    audit: {
      async started(input) {
        if (!input.context.conversationId) return undefined;
        const row = await createSubagentRunsDal(db).start(userId, {
          conversationId: input.context.conversationId,
          parentSessionId: input.context.parentSessionId,
          childSessionId: input.childSessionId,
          timeoutMs: input.timeoutMs,
          modelProviderId: model.providerId,
          modelId: model.modelId,
        });
        return { id: row.id };
      },
      async finished(input) {
        if (!input.id) return;
        await createSubagentRunsDal(db).finish(userId, input.id, {
          status: input.result.status,
          error: input.result.error ?? null,
        });
      },
    },
    createRuntime: ({ session, context, focus }) => {
      const prompt = buildPrompt(PROMPT_IDS.CHAT_SUBAGENT, {
        focusLine: focus ? `Focus for this run: ${focus}` : '',
        parentSessionId: context.parentSessionId,
      });
      return createAgentRuntime({
        session,
        llm,
        systemPrompt: prompt.system,
        telemetry: {
          context: createRuntimeTelemetryContext(runtimeTelemetry),
          attributes: {
            ownerId: userId,
            sessionId: session.descriptor.id,
            ...(context.conversationId ? { conversationId: context.conversationId } : {}),
            modelProviderId: model.providerId,
            modelId: model.modelId,
            thinkingLevel: model.thinkingLevel,
            promptId: PROMPT_IDS.CHAT_SUBAGENT,
            promptRevision: prompt.revision,
          },
          onRunFinished: context.conversationId
            ? async (observation) => {
              await observations.record(userId, {
              conversationId: context.conversationId!,
              sessionId: session.descriptor.id,
              modelProviderId: model.providerId,
              modelId: model.modelId,
              observation,
              });
            }
            : undefined,
        },
      });
    },
  });
  registry.register(createSubagentTool(childExecutor));

  const tools = registry.createAgentTools({
    context: { ownerId: userId, sessionId: conversation.sessionId, conversationId: conversation.id },
    telemetry,
    approval: approvals,
    enabledToolNames: new Set(
      registry.list()
        .filter((tool) => toolOverrides.get(tool.name)?.enabled ?? tool.defaultEnabled)
        .map((tool) => tool.name),
    ),
    approvalModes: new Map(
      toolSettings.map((setting) => [setting.toolName, setting.approval as ToolApprovalMode]),
    ),
    errorChannel: toolErrorChannel,
  });
  const mainPrompt = buildPrompt(PROMPT_IDS.CHAT_MAIN, {
    skillsPrompt: skills.systemPrompt(enabledSkillNames),
  });
  const runtime = await createAgentRuntime({
    session,
    llm,
    systemPrompt: mainPrompt.system,
    tools,
    telemetry: {
      context: telemetry,
      attributes: {
        ownerId: userId,
        sessionId: conversation.sessionId,
        conversationId: conversation.id,
        modelProviderId: model.providerId,
        modelId: model.modelId,
        thinkingLevel: model.thinkingLevel,
        promptId: PROMPT_IDS.CHAT_MAIN,
        promptRevision: mainPrompt.revision,
      },
      onRunFinished: async (observation) => {
        await observations.record(userId, {
          conversationId: conversation.id,
          sessionId: conversation.sessionId,
          modelProviderId: model.providerId,
          modelId: model.modelId,
          observation,
        });
      },
    },
    toolErrorChannel,
  });
  const entry = {
    ownerId: userId,
    runtime,
    session,
    approvals,
    mcp,
    model,
    ...(options.knowledgeBaseId ? { knowledgeBaseId: options.knowledgeBaseId } : {}),
  };
  activeRuntimes.set(conversation.id, entry);
  return entry;
}

export function getActiveRuntime(conversationId: string) {
  return activeRuntimes.get(conversationId);
}

export async function closeRuntime(conversationId: string) {
  const entry = activeRuntimes.get(conversationId);
  if (!entry) return;
  activeRuntimes.delete(conversationId);
  try {
    await createToolApprovalsDal(getDb()).rejectPendingByConversation(
      entry.ownerId,
      conversationId,
    );
  } finally {
    entry.approvals.rejectAll();
    await entry.mcp.close();
  }
}

export async function closeUserRuntimes(userId: string) {
  const entries = Array.from(activeRuntimes.entries())
    .filter(([, entry]) => entry.ownerId === userId);
  await Promise.all(entries.map(([conversationId]) => closeRuntime(conversationId)));
}

export async function createSession(userId: string) {
  return getSessionRepository().create({ ownerId: userId });
}

export async function openSession(userId: string, sessionId: string, sessionFilePath?: string) {
  return getSessionRepository().open(userId, sessionId, sessionFilePath);
}

export async function deleteSession(userId: string, sessionId: string, sessionFilePath?: string) {
  await getSessionRepository().delete(userId, sessionId, sessionFilePath);
}

export async function listRuntimeTools(userId: string) {
  if (!userId) throw new Error('Tools require an authenticated user');
  const mcp = new McpManager();
  try {
    const rows = await createMcpServersDal(getDb()).list(userId);
    const canUseStdio = await canUseStdioMcp(userId);
    for (const row of rows.filter((server) => server.enabled && (canUseStdio || server.transport !== 'stdio'))) {
      mcp.register({
        id: row.id,
        name: row.name,
        transport: row.transport as 'stdio' | 'sse' | 'http',
        ...(row.command ? { command: row.command } : {}),
        ...(Array.isArray(row.args) ? { args: row.args.filter((arg): arg is string => typeof arg === 'string') } : {}),
        ...(row.url ? { url: row.url } : {}),
        ...(row.envEnc ? { env: JSON.parse(decrypt(row.envEnc)) as Record<string, string> } : {}),
        enabled: row.enabled,
      });
    }
    const { registry: skills, enabledSkillNames } = await loadUserSkills(userId);
    const registry = createBuiltinTools(userId, mcp, createReadSkillTool(skills, enabledSkillNames));
    for (const tool of mcp.proxyTools()) registry.register(tool);
    // RAG is bound to a mounted knowledge base at chat-runtime creation time,
    // but remains a user-configurable tool in the global settings catalog.
    return [...registry.list(), knowledgeBaseSearchToolSummary];
  } finally {
    await mcp.close();
  }
}
