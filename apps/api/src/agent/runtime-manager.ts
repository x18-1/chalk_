import { resolve } from 'node:path';

import {
  AgentRuntime,
  createAgentRuntime,
  createJsonlSessionRepository,
  createModelCatalog,
  McpManager,
  ForegroundSubagentExecutor,
  createSubagentTool,
  SkillRegistry,
  type ApprovalPort,
  type ModelRef,
  type RuntimeSession,
  type ToolApprovalMode,
} from '@chalk/agent-runtime';

import { getDb } from '../db/client';
import {
  createAgentSettingsDal,
  createCustomProvidersDal,
  createMcpServersDal,
  createSubagentRunsDal,
  createSkillSettingsDal,
  createToolApprovalsDal,
  createToolSettingsDal,
} from '../db/dal';
import { decrypt } from './credentials/encrypt';
import { DrizzleCredentialStore } from './credentials/store';
import { createBuiltinToolRegistry } from './builtin-tools';
import { runtimeTelemetry } from './telemetry';

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

type PendingApproval = {
  resolve: (decision: { approved: boolean; reason?: string }) => void;
  reject: (error: Error) => void;
};

class ApprovalBroker implements ApprovalPort {
  private readonly pending = new Map<string, PendingApproval>();

  constructor(private readonly userId: string) {}

  async request(request: Parameters<ApprovalPort['request']>[0], signal?: AbortSignal) {
    const conversationId = request.context.conversationId;
    if (!conversationId) {
      return { approved: false, reason: 'Approval requires a conversation context' };
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

    return new Promise<{ approved: boolean; reason?: string }>((resolveDecision, rejectDecision) => {
      let settled = false;
      let timeout: NodeJS.Timeout | undefined;

      const cleanup = () => {
        this.pending.delete(key);
        signal?.removeEventListener('abort', abort);
        if (timeout) clearTimeout(timeout);
      };
      const resolve = (decision: { approved: boolean; reason?: string }) => {
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
        void approvals.updateStatusByToolCall(
          this.userId,
          conversationId,
          request.toolCallId,
          'rejected',
        ).catch(() => undefined);
        reject(new Error('Tool approval was aborted'));
      };

      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(key, { resolve, reject });

      timeout = setTimeout(() => {
        const current = this.pending.get(key);
        if (!current) return;
        void approvals.updateStatusByToolCall(
          this.userId,
          conversationId,
          request.toolCallId,
          'rejected',
        ).catch(() => undefined);
        current.resolve({ approved: false, reason: 'Tool approval timed out' });
      }, Number(process.env.TOOL_APPROVAL_TIMEOUT_MS ?? 120_000));
      void row;
    });
  }

  async decide(conversationId: string, toolCallId: string, approved: boolean, reason?: string) {
    const db = getDb();
    const approvals = createToolApprovalsDal(db);
    await approvals.updateStatusByToolCall(this.userId, conversationId, toolCallId, approved ? 'approved' : 'rejected');
    const pending = this.pending.get(`${conversationId}:${toolCallId}`);
    if (!pending) return;
    this.pending.delete(`${conversationId}:${toolCallId}`);
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
  model: ModelRef;
};

const activeRuntimes = new Map<string, RuntimeEntry>();

function skillSources() {
  return (process.env.SKILLS_DIRS ?? '')
    .split(':')
    .map((path) => path.trim())
    .filter(Boolean)
    .map((path, index) => ({
      id: `configured-${index}`,
      label: path,
      path: resolve(process.cwd(), path),
      trusted: true,
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
        modelIds: Array.isArray(provider.modelIds)
          ? provider.modelIds.filter((model): model is string => typeof model === 'string')
          : [],
        ...(provider.apiKeyEnc ? { apiKey: decrypt(provider.apiKeyEnc) } : {}),
      })),
  });
}

export async function selectModel(userId: string, requested?: ModelRef) {
  const catalog = await createCatalog(userId);
  if (requested) return { catalog, model: requested };

  const settings = await createAgentSettingsDal(getDb()).get(userId);
  if (settings?.defaultProviderId && settings.defaultModelId) {
    return {
      catalog,
      model: {
        providerId: settings.defaultProviderId,
        modelId: settings.defaultModelId,
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
    model: { providerId: preferred.providerId, modelId: preferred.id },
  };
}

export async function createUserModelCatalog(userId: string) {
  return createCatalog(userId);
}

export async function loadUserSkills(userId: string) {
  if (!userId) throw new Error('Skills require an authenticated user');
  const skills = new SkillRegistry(process.cwd(), skillSources());
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
  conversation: { id: string; sessionId: string },
  requestedModel?: ModelRef,
) {
  const db = getDb();
  const settings = await createAgentSettingsDal(db).get(userId);
  const selectedModel = requestedModel ?? (
    settings?.defaultProviderId && settings.defaultModelId
      ? { providerId: settings.defaultProviderId, modelId: settings.defaultModelId }
      : undefined
  );
  const existing = activeRuntimes.get(conversation.id);
  if (existing && (!selectedModel ||
    existing.model.providerId === selectedModel.providerId &&
    existing.model.modelId === selectedModel.modelId)) {
    return existing;
  }
  if (existing) await closeRuntime(conversation.id);

  const session = await getSessionRepository().open(conversation.sessionId);
  if (session.descriptor.ownerId && session.descriptor.ownerId !== userId) {
    throw new Error('Session owner does not match conversation owner');
  }

  const { catalog, model } = await selectModel(userId, requestedModel);
  const skills = new SkillRegistry(process.cwd(), skillSources());
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
  for (const row of mcpRows.filter((server) => server.enabled)) {
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
  const toolOverrides = new Map(toolSettings.map((setting) => [setting.toolName, setting]));
  const registry = createBuiltinToolRegistry();
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
    createRuntime: ({ session, context, focus }) =>
      createAgentRuntime({
        session,
        models: catalog,
        model,
        systemPrompt: [
          '你是 Chalk 的专项子 Agent。只处理父 Agent 分配的范围，不扩展任务，不直接与学生对话。',
          focus ? `本次重点：${focus}` : '',
          `父会话：${context.parentSessionId}`,
        ].filter(Boolean).join('\n'),
        telemetry: {
          context: runtimeTelemetry,
          attributes: {
            ownerId: userId,
            sessionId: session.descriptor.id,
            ...(context.conversationId ? { conversationId: context.conversationId } : {}),
            modelProviderId: model.providerId,
            modelId: model.modelId,
          },
        },
      }),
  });
  registry.register(createSubagentTool(childExecutor));

  const tools = registry.createAgentTools({
    context: { ownerId: userId, sessionId: conversation.sessionId, conversationId: conversation.id },
    approval: approvals,
    enabledToolNames: new Set(
      registry.list()
        .filter((tool) => toolOverrides.get(tool.name)?.enabled ?? true)
        .map((tool) => tool.name),
    ),
    approvalModes: new Map(
      toolSettings.map((setting) => [setting.toolName, setting.approval as ToolApprovalMode]),
    ),
  });
  const systemPrompt = [
    '你是 Chalk，一位耐心、严谨的数学老师。目标是帮助学生掌握解题思路，而不是只报出答案。',
    '先确认已知条件和学生卡住的位置，再给一条可执行的下一步；学生明确需要时再逐级增加提示。',
    skills.systemPrompt(enabledSkillNames),
  ].filter(Boolean).join('\n\n');
  const runtime = await createAgentRuntime({
    session,
    models: catalog,
    model,
    systemPrompt,
    tools,
    telemetry: {
      context: runtimeTelemetry,
      attributes: {
        ownerId: userId,
        sessionId: conversation.sessionId,
        conversationId: conversation.id,
        modelProviderId: model.providerId,
        modelId: model.modelId,
      },
    },
  });
  const entry = { ownerId: userId, runtime, session, approvals, mcp, model };
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
  entry.approvals.rejectAll();
  await entry.mcp.close();
}

export async function closeUserRuntimes(userId: string) {
  const entries = Array.from(activeRuntimes.entries())
    .filter(([, entry]) => entry.ownerId === userId);
  await Promise.all(entries.map(([conversationId]) => closeRuntime(conversationId)));
}

export async function createSession(userId: string) {
  return getSessionRepository().create({ ownerId: userId });
}

export async function openSession(sessionId: string) {
  return getSessionRepository().open(sessionId);
}

export async function deleteSession(sessionId: string) {
  await getSessionRepository().delete(sessionId);
}

export async function listRuntimeTools(userId: string) {
  if (!userId) throw new Error('Tools require an authenticated user');
  const registry = createBuiltinToolRegistry();
  const mcp = new McpManager();
  try {
    const rows = await createMcpServersDal(getDb()).list(userId);
    for (const row of rows.filter((server) => server.enabled)) {
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
    for (const tool of mcp.proxyTools()) registry.register(tool);
    return registry.list();
  } finally {
    await mcp.close();
  }
}
