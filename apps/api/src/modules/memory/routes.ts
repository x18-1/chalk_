import type { FastifyInstance } from 'fastify';
import type { AuthModule } from '../../auth/auth-module';
import { memoryEntryCreateSchema, memoryEntryParamsSchema, memoryEntryUpdateSchema, memoryEventListQuerySchema, memoryConsolidationSchema, memoryListQuerySchema, memoryRunListQuerySchema } from './schemas';
import type { MemoryService } from './services/memory.service';
import type { MemoryConsolidationService } from './services/memory-consolidation.service';

export function registerMemoryRoutes(app: FastifyInstance, auth: AuthModule, memory: MemoryService, consolidation?: MemoryConsolidationService) {
  app.get('/memory', async (request) => {
    const user = await auth.requireUser(request);
    const query = memoryListQuerySchema.parse(request.query);
    const entries = await memory.listEntries(user.id, query);
    return { entries };
  });

  app.get('/memory/context', async (request) => {
    const user = await auth.requireUser(request);
    return { memory: await memory.read(user.id) };
  });

  app.post('/memory/entries', async (request, reply) => {
    const user = await auth.requireUser(request);
    const input = memoryEntryCreateSchema.parse(request.body);
    return reply.code(201).send({ entry: await memory.createEntry(user.id, input) });
  });

  app.get('/memory/entries/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = memoryEntryParamsSchema.parse(request.params);
    return { entry: await memory.getEntry(user.id, id) };
  });

  app.patch('/memory/entries/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = memoryEntryParamsSchema.parse(request.params);
    const input = memoryEntryUpdateSchema.parse(request.body);
    return { entry: await memory.updateEntry(user.id, id, input) };
  });

  app.delete('/memory/entries/:id', async (request) => {
    const user = await auth.requireUser(request);
    const { id } = memoryEntryParamsSchema.parse(request.params);
    return { entry: await memory.updateEntry(user.id, id, { status: 'archived' }) };
  });

  app.get('/memory/events', async (request) => {
    const user = await auth.requireUser(request);
    const query = memoryEventListQuerySchema.parse(request.query);
    return { events: await memory.listEvents(user.id, query) };
  });

  if (consolidation) {
    app.get('/memory/consolidation/runs', async (request) => {
      const user = await auth.requireUser(request);
      const query = memoryRunListQuerySchema.parse(request.query);
      return { runs: await memory.listConsolidationRuns(user.id, query.limit) };
    });
    app.post('/memory/consolidation', async (request) => {
      const user = await auth.requireUser(request);
      const body = memoryConsolidationSchema.parse(request.body ?? {});
      return { run: await consolidation.run(user.id, body) };
    });
  }
}
