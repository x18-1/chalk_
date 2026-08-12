import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AuthModule } from '../../auth/auth-module';
import { getDb } from '../../db/client';
import {
  createAgentSettingsDal,
  createCustomProvidersDal,
  createSkillSettingsDal,
  createToolSettingsDal,
} from '../../db/dal';
import { encrypt } from '../../agent/credentials/encrypt';
import { closeUserRuntimes, createUserModelCatalog, listRuntimeTools, loadUserSkills } from '../../agent/runtime-manager';
import { ApiError } from '../../http/errors';
import { httpUrlSchema } from '../../http/validation';

const providerParams = z.object({ providerId: z.string().min(1).max(100) });
const customParams = z.object({ id: z.string().uuid() });
const modelSchema = z.object({ providerId: z.string().min(1).max(100), modelId: z.string().min(1).max(200) });

const customProviderSchema = z.object({
  name: z.string().trim().min(1).max(100),
  baseUrl: httpUrlSchema,
  api: z.literal('openai-completions').default('openai-completions'),
  apiKey: z.string().trim().max(10_000).optional(),
  modelIds: z.array(z.string().trim().min(1).max(200)).max(200),
  enabled: z.boolean().default(true),
});

const customProviderUpdateSchema = customProviderSchema.partial();

function publicCustomProvider(row: {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  modelIds: unknown;
  enabled: boolean;
  apiKeyEnc: string | null;
}) {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    api: row.api,
    modelIds: row.modelIds,
    enabled: row.enabled,
    configured: Boolean(row.apiKeyEnc),
  };
}

export function registerConfigurationRoutes(app: FastifyInstance, auth: AuthModule) {
  app.get('/providers', async (request) => {
    const user = await auth.requireUser(request);
    const catalog = await createUserModelCatalog(user.id);
    const [providers, custom, settings] = await Promise.all([
      catalog.listProviders(),
      createCustomProvidersDal(getDb()).list(user.id),
      createAgentSettingsDal(getDb()).get(user.id),
    ]);
    return {
      providers,
      customProviders: custom.map(publicCustomProvider),
      defaultModel: settings?.defaultProviderId && settings.defaultModelId
        ? { providerId: settings.defaultProviderId, modelId: settings.defaultModelId }
        : null,
    };
  });

  app.put('/providers/:providerId/credential', async (request) => {
    const user = await auth.requireUser(request);
    const { providerId } = providerParams.parse(request.params);
    const { apiKey } = z.object({ apiKey: z.string().trim().min(1).max(10_000) }).parse(request.body);
    const catalog = await createUserModelCatalog(user.id);
    const providers = await catalog.listProviders();
    if (!providers.some((provider) => provider.id === providerId)) {
      throw new ApiError(404, 'Provider not found', 'PROVIDER_NOT_FOUND');
    }
    const { DrizzleCredentialStore } = await import('../../agent/credentials/store');
    await new DrizzleCredentialStore(getDb(), user.id).modify(providerId, async () => ({ type: 'api_key', key: apiKey }));
    await closeUserRuntimes(user.id);
    return { providerId, configured: true };
  });

  app.delete('/providers/:providerId/credential', async (request) => {
    const user = await auth.requireUser(request);
    const { providerId } = providerParams.parse(request.params);
    const { DrizzleCredentialStore } = await import('../../agent/credentials/store');
    await new DrizzleCredentialStore(getDb(), user.id).delete(providerId);
    await closeUserRuntimes(user.id);
    return { providerId, configured: false };
  });

  app.get('/providers/custom', async (request) => {
    const user = await auth.requireUser(request);
    return { providers: (await createCustomProvidersDal(getDb()).list(user.id)).map(publicCustomProvider) };
  });

  app.post('/providers/custom', async (request, reply) => {
    const user = await auth.requireUser(request);
    const input = customProviderSchema.parse(request.body);
    const row = await createCustomProvidersDal(getDb()).create(user.id, {
      name: input.name,
      baseUrl: input.baseUrl,
      api: input.api,
      modelIds: input.modelIds,
      enabled: input.enabled,
      ...(input.apiKey ? { apiKeyEnc: encrypt(input.apiKey) } : {}),
    });
    await closeUserRuntimes(user.id);
    return reply.code(201).send({ provider: publicCustomProvider(row) });
  });

  app.patch('/providers/custom/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = customParams.parse(request.params);
    const input = customProviderUpdateSchema.parse(request.body);
    const { apiKey, ...data } = input;
    const row = await createCustomProvidersDal(getDb()).update(user.id, id, {
      ...data,
      ...(apiKey !== undefined ? { apiKeyEnc: apiKey ? encrypt(apiKey) : null } : {}),
    });
    await closeUserRuntimes(user.id);
    return { provider: publicCustomProvider(row) };
  });

  app.delete('/providers/custom/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = customParams.parse(request.params);
    await createCustomProvidersDal(getDb()).delete(user.id, id);
    await closeUserRuntimes(user.id);
    return { ok: true };
  });

  app.get('/models', async (request) => {
    const user = await auth.requireUser(request);
    const provider = z.object({ provider: z.string().min(1).max(100).optional() }).parse(request.query).provider;
    const catalog = await createUserModelCatalog(user.id);
    return { models: provider ? catalog.listModels(provider) : await catalog.getAvailableModels() };
  });

  app.post('/models', async (request) => {
    const user = await auth.requireUser(request);
    const provider = z.object({ provider: z.string().min(1).max(100).optional() }).parse(request.query).provider;
    const catalog = await createUserModelCatalog(user.id);
    return catalog.refresh(provider ? [provider] : undefined);
  });

  app.get('/settings', async (request) => {
    const user = await auth.requireUser(request);
    const settings = await createAgentSettingsDal(getDb()).get(user.id);
    return {
      defaultModel: settings?.defaultProviderId && settings.defaultModelId
        ? { providerId: settings.defaultProviderId, modelId: settings.defaultModelId }
        : null,
    };
  });

  app.put('/settings/model', async (request) => {
    const user = await auth.requireUser(request);
    const model = modelSchema.parse(request.body);
    await createUserModelCatalog(user.id).then((catalog) => catalog.resolve(model));
    const settings = await createAgentSettingsDal(getDb()).setDefaultModel(user.id, model);
    await closeUserRuntimes(user.id);
    return { defaultModel: { providerId: settings.defaultProviderId, modelId: settings.defaultModelId } };
  });

  app.get('/skills', async (request) => {
    const user = await auth.requireUser(request);
    const [{ snapshot }, settings] = await Promise.all([
      loadUserSkills(user.id),
      createSkillSettingsDal(getDb()).list(user.id),
    ]);
    const overrides = new Map(settings.map((setting) => [setting.skillName, setting.enabled]));
    return {
      skills: snapshot.skills.map((skill) => ({ ...skill, enabled: overrides.get(skill.name) ?? true })),
      diagnostics: snapshot.diagnostics,
    };
  });

  app.patch('/skills', async (request) => {
    const user = await auth.requireUser(request);
    const input = z.object({ skillName: z.string().min(1).max(64), enabled: z.boolean() }).parse(request.body);
    const { snapshot } = await loadUserSkills(user.id);
    if (!snapshot.skills.some((skill) => skill.name === input.skillName)) {
      throw new ApiError(404, 'Skill not found', 'SKILL_NOT_FOUND');
    }
    const setting = await createSkillSettingsDal(getDb()).setEnabled(user.id, input.skillName, input.enabled);
    await closeUserRuntimes(user.id);
    return { setting };
  });

  app.get('/tools', async (request) => {
    const user = await auth.requireUser(request);
    const [tools, settings] = await Promise.all([
      listRuntimeTools(user.id),
      createToolSettingsDal(getDb()).list(user.id),
    ]);
    const overrides = new Map(settings.map((setting) => [setting.toolName, setting]));
    return {
      tools: tools.map((tool) => ({
        ...tool,
        enabled: overrides.get(tool.name)?.enabled ?? true,
        approval: overrides.get(tool.name)?.approval ?? 'default',
      })),
    };
  });

  app.patch('/tools', async (request) => {
    const user = await auth.requireUser(request);
    const input = z.object({
      toolName: z.string().min(1).max(200),
      enabled: z.boolean(),
      approval: z.enum(['default', 'always', 'never']).default('default'),
    }).parse(request.body);
    const tools = await listRuntimeTools(user.id);
    if (!tools.some((tool) => tool.name === input.toolName)) {
      throw new ApiError(404, 'Tool not found', 'TOOL_NOT_FOUND');
    }
    const setting = await createToolSettingsDal(getDb()).upsert(user.id, input.toolName, input);
    await closeUserRuntimes(user.id);
    return { setting };
  });
}
