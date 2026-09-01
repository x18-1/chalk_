import type { FastifyInstance } from 'fastify';

import type { AuthModule } from '../../auth/auth-module';
import {
  customProviderParamsSchema,
  customProviderSchema,
  customProviderUpdateSchema,
  capabilitySettingsSchema,
  modelSelectionSchema,
  memorySettingsSchema,
  modelsQuerySchema,
  providerCredentialSchema,
  providerParamsSchema,
  providerTestSchema,
  skillSettingSchema,
  skillNameParamsSchema,
  toolSettingSchema,
  userSkillCreateSchema,
  userSkillUpdateSchema,
  userSkillParamsSchema,
  ragSettingsSchema,
} from './schemas';
import type { ProviderConfigurationService } from './services/provider-configuration.service';
import type { RuntimeConfigurationService } from './services/runtime-configuration.service';
import type { CapabilityConfigurationService } from './services/capability-configuration.service';
import type { SkillStoreService } from './services/skill-store.service';

export function registerConfigurationRoutes(
  app: FastifyInstance,
  auth: AuthModule,
  providers: ProviderConfigurationService,
  runtime: RuntimeConfigurationService,
  capabilities: CapabilityConfigurationService,
  skillStore?: SkillStoreService,
) {
  app.get('/providers', async (request) => {
    const user = await auth.requireUser(request);
    return providers.listProviders(user.id);
  });

  app.put('/providers/:providerId/credential', async (request) => {
    const user = await auth.requireUser(request);
    const { providerId } = providerParamsSchema.parse(request.params);
    const { apiKey } = providerCredentialSchema.parse(request.body);
    return providers.saveCredential(user.id, providerId, apiKey);
  });

  app.delete('/providers/:providerId/credential', async (request) => {
    const user = await auth.requireUser(request);
    const { providerId } = providerParamsSchema.parse(request.params);
    return providers.removeCredential(user.id, providerId);
  });

  app.post('/providers/:providerId/test', async (request) => {
    const user = await auth.requireUser(request);
    const { providerId } = providerParamsSchema.parse(request.params);
    const { modelId } = providerTestSchema.parse(request.body);
    return providers.testProvider(user.id, providerId, modelId);
  });

  app.get('/providers/custom', async (request) => {
    const user = await auth.requireUser(request);
    return providers.listCustomProviders(user.id);
  });

  app.post('/providers/custom', async (request, reply) => {
    const user = await auth.requireUser(request);
    const provider = await providers.createCustomProvider(
      user.id,
      customProviderSchema.parse(request.body),
    );
    return reply.code(201).send({ provider });
  });

  app.patch('/providers/custom/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = customProviderParamsSchema.parse(request.params);
    const provider = await providers.updateCustomProvider(
      user.id,
      id,
      customProviderUpdateSchema.parse(request.body),
    );
    return { provider };
  });

  app.delete('/providers/custom/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = customProviderParamsSchema.parse(request.params);
    await providers.deleteCustomProvider(user.id, id);
    return { ok: true };
  });

  app.get('/models', async (request) => {
    const user = await auth.requireUser(request);
    const { provider } = modelsQuerySchema.parse(request.query);
    return providers.listModels(user.id, provider);
  });

  app.post('/models', async (request) => {
    const user = await auth.requireUser(request);
    const { provider } = modelsQuerySchema.parse(request.query);
    return providers.refreshModels(user.id, provider);
  });

  app.get('/settings', async (request) => {
    const user = await auth.requireUser(request);
    return providers.getSettings(user.id);
  });

  app.get('/settings/rag', async (request) => {
    const user = await auth.requireUser(request);
    return providers.getRagSettings(user.id);
  });

  app.put('/settings/rag', async (request) => {
    const user = await auth.requireUser(request);
    return providers.updateRagSettings(user.id, ragSettingsSchema.parse(request.body));
  });

  app.put('/settings/model', async (request) => {
    const user = await auth.requireUser(request);
    return providers.setDefaultModel(
      user.id,
      modelSelectionSchema.parse(request.body),
    );
  });

  app.put('/settings/memory', async (request) => {
    const user = await auth.requireUser(request);
    const { enabled } = memorySettingsSchema.parse(request.body);
    return providers.setMemoryInjectionEnabled(user.id, enabled);
  });

  app.get('/settings/capabilities', async (request) => {
    const user = await auth.requireUser(request);
    return capabilities.get(user.id);
  });

  app.put('/settings/capabilities', async (request) => {
    const user = await auth.requireUser(request);
    return capabilities.update(user.id, capabilitySettingsSchema.parse(request.body));
  });

  app.get('/skills', async (request) => {
    const user = await auth.requireUser(request);
    return runtime.listSkills(user.id);
  });

  app.get('/skills/:name', async (request) => {
    const user = await auth.requireUser(request);
    const { name } = skillNameParamsSchema.parse(request.params);
    return runtime.getSkill(user.id, name);
  });

  app.patch('/skills', async (request) => {
    const user = await auth.requireUser(request);
    return runtime.setSkill(user.id, skillSettingSchema.parse(request.body));
  });

  app.get('/tools', async (request) => {
    const user = await auth.requireUser(request);
    return runtime.listTools(user.id);
  });

  app.patch('/tools', async (request) => {
    const user = await auth.requireUser(request);
    return runtime.setTool(user.id, toolSettingSchema.parse(request.body));
  });

  if (skillStore) {
    app.get('/user-skills', async (request) => {
      const user = await auth.requireUser(request);
      return skillStore.list(user.id);
    });
    app.post('/user-skills', async (request, reply) => {
      const user = await auth.requireUser(request);
      const skill = await skillStore.create(user.id, userSkillCreateSchema.parse(request.body));
      return reply.code(201).send({ skill });
    });
    app.get('/user-skills/:id', async (request) => {
      const user = await auth.requireUser(request);
      const { id } = userSkillParamsSchema.parse(request.params);
      return skillStore.get(user.id, id);
    });
    app.patch('/user-skills/:id', async (request) => {
      const user = await auth.requireUser(request);
      const { id } = userSkillParamsSchema.parse(request.params);
      return { skill: await skillStore.update(user.id, id, userSkillUpdateSchema.parse(request.body)) };
    });
    app.delete('/user-skills/:id', async (request) => {
      const user = await auth.requireUser(request);
      const { id } = userSkillParamsSchema.parse(request.params);
      await skillStore.delete(user.id, id);
      return { ok: true };
    });
  }
}
