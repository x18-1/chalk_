import type { FastifyInstance } from 'fastify';

import type { AuthModule } from '../../auth/auth-module';
import {
  customProviderParamsSchema,
  customProviderSchema,
  customProviderUpdateSchema,
  capabilitySettingsSchema,
  modelSelectionSchema,
  modelsQuerySchema,
  providerCredentialSchema,
  providerParamsSchema,
  providerTestSchema,
  skillSettingSchema,
  toolSettingSchema,
} from './schemas';
import type { ProviderConfigurationService } from './services/provider-configuration.service';
import type { RuntimeConfigurationService } from './services/runtime-configuration.service';
import type { CapabilityConfigurationService } from './services/capability-configuration.service';

export function registerConfigurationRoutes(
  app: FastifyInstance,
  auth: AuthModule,
  providers: ProviderConfigurationService,
  runtime: RuntimeConfigurationService,
  capabilities: CapabilityConfigurationService,
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

  app.put('/settings/model', async (request) => {
    const user = await auth.requireUser(request);
    return providers.setDefaultModel(
      user.id,
      modelSelectionSchema.parse(request.body),
    );
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
}
