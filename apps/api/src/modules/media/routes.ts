import type { FastifyInstance } from 'fastify';
import type { AuthModule } from '../../auth/auth-module';
import { mediaCapabilitySchema, mediaCredentialSchema, mediaProviderParamsSchema, mediaTestSchema, videoTaskParamsSchema, videoTaskQuerySchema, videoSubmitSchema, ttsRequestSchema, asrRequestSchema, imageRequestSchema } from './schemas';
import type { MediaProviderService } from './services/media-provider.service';

export function registerMediaRoutes(app: FastifyInstance, auth: AuthModule, media: MediaProviderService) {
  app.get('/media/providers', async (request) => media.listProviders((await auth.requireUser(request)).id));
  app.put('/media/providers/:capability/:providerId/credential', async (request) => {
    const user = await auth.requireUser(request);
    const { capability, providerId } = mediaProviderParamsSchema.parse(request.params);
    return media.saveCredential(user.id, capability, providerId, mediaCredentialSchema.parse(request.body));
  });
  app.delete('/media/providers/:capability/:providerId/credential', async (request) => {
    const user = await auth.requireUser(request);
    const { capability, providerId } = mediaProviderParamsSchema.parse(request.params);
    return media.removeCredential(user.id, capability, providerId);
  });
  app.post('/media/providers/:capability/:providerId/test', async (request) => {
    const user = await auth.requireUser(request);
    const { capability, providerId } = mediaProviderParamsSchema.parse(request.params);
    return media.testConnection(user.id, capability, providerId, mediaTestSchema.parse(request.body ?? {}).model);
  });
  app.post('/media/tts', async (request) => media.synthesize((await auth.requireUser(request)).id, ttsRequestSchema.parse(request.body)));
  app.post('/media/asr', async (request) => media.transcribe((await auth.requireUser(request)).id, asrRequestSchema.parse(request.body)));
  app.post('/media/image', async (request) => media.generateImage((await auth.requireUser(request)).id, imageRequestSchema.parse(request.body)));
  app.get('/media/image/comfyui/workflows', async (request) => { await auth.requireUser(request); return { workflows: await media.listComfyWorkflows() }; });
  app.post('/media/video/tasks', async (request) => ({ task: await media.submitVideo((await auth.requireUser(request)).id, videoSubmitSchema.parse(request.body)) }));
  app.get('/media/video/tasks/:providerId/:taskId', async (request) => {
    const user = await auth.requireUser(request);
    const { providerId, taskId } = videoTaskParamsSchema.parse(request.params);
    return { task: await media.pollVideo(user.id, providerId, taskId, videoTaskQuerySchema.parse(request.query ?? {}).model) };
  });
  void mediaCapabilitySchema;
}
