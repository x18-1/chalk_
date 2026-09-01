import { z } from 'zod';
import type { MemoryService } from './memory.service';

const operationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), layer: z.enum(['L2', 'L3']), surface: z.string().trim().min(1).max(64).optional(), slot: z.string().trim().min(1).max(64).optional(), section: z.string().trim().min(1).max(80), text: z.string().trim().min(1).max(240), refs: z.array(z.string().trim().min(1).max(200)).min(1).max(32) }),
  z.object({ op: z.literal('edit'), id: z.string().uuid(), text: z.string().trim().min(1).max(240).optional(), section: z.string().trim().min(1).max(80).optional(), refs: z.array(z.string().trim().min(1).max(200)).min(1).max(32).optional() }).refine((value) => value.text !== undefined || value.section !== undefined || value.refs !== undefined),
  z.object({ op: z.literal('delete'), id: z.string().uuid() }),
]);

export type MemoryConsolidationOperation = z.infer<typeof operationSchema>;
export type MemoryConsolidationModel = (input: { userId: string; events: readonly unknown[]; entries: readonly unknown[] }) => Promise<unknown>;

function parseOperations(value: unknown): MemoryConsolidationOperation[] {
  const raw = typeof value === 'string' ? value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '') : value;
  let parsed: unknown = raw;
  if (typeof raw === 'string') { try { parsed = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    // Some OpenAI-compatible models emit the natural-language alias
    // `operation` even when the contract says `op`. Normalize that one
    // harmless spelling variant before applying the strict schema below.
    const candidate = item && typeof item === 'object' && !Array.isArray(item)
      ? item as Record<string, unknown>
      : undefined;
    const normalized = candidate && candidate.op === undefined && typeof candidate.operation === 'string'
      ? { ...candidate, op: candidate.operation }
      : item;
    const result = operationSchema.safeParse(normalized);
    return result.success ? [result.data] : [];
  });
}

function eventText(event: any) {
  const payload = event.payload as any;
  const candidate = payload?.text ?? payload?.content ?? payload?.message;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim().slice(0, 240) : null;
}
function chunk<T>(items: readonly T[], size: number) { const result: T[][] = []; for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size)); return result; }

/** DeepTutor-style two-stage, bounded consolidation with owner-scoped references. */
export class MemoryConsolidationService {
  private static readonly activeUsers = new Set<string>();
  constructor(private readonly memory: MemoryService, private readonly model?: MemoryConsolidationModel) {}

  async run(userId: string, options: { limit?: number; model?: MemoryConsolidationModel } = {}) {
    if (MemoryConsolidationService.activeUsers.has(userId)) return { processed: 0, promoted: 0, added: 0, edited: 0, deleted: 0, operations: [] as MemoryConsolidationOperation[], skipped: true };
    MemoryConsolidationService.activeUsers.add(userId);
    try {
      return await this.runLocked(userId, options);
    } finally {
      MemoryConsolidationService.activeUsers.delete(userId);
    }
  }

  private async runLocked(userId: string, options: { limit?: number; model?: MemoryConsolidationModel } = {}) {
    const limit = Math.min(options.limit ?? 100, 200);
    // Read a wider oldest-first window, then process only a bounded batch. This
    // prevents already-seen old events from starving newer unprocessed events.
    const events = await this.memory.listEvents(userId, { limit: 5_000 });
    const l2Cursor = await this.memory.getCursor(userId, 'L2', 'events');
    const seenEvents = new Set(l2Cursor?.seenRefs ?? []);
    const pendingEvents = events.filter((event) => !seenEvents.has(event.id)).slice(0, limit);
    const model = options.model ?? this.model;
    const l2Entries = (await this.memory.listEntries(userId, { layer: 'L2', includeArchived: true })).slice(-100);
    let added = 0; let edited = 0; let deleted = 0; const operations: MemoryConsolidationOperation[] = [];
    for (const eventChunk of chunk(pendingEvents, 24)) {
      const generated = model ? parseOperations(await model({ userId, events: eventChunk, entries: l2Entries })) : eventChunk.flatMap((event) => { const text = eventText(event); return text ? [{ op: 'add' as const, layer: 'L2' as const, surface: event.surface, section: event.kind, text, refs: [event.id] }] : []; });
      const result = await this.apply(userId, generated, 'L2', events, l2Entries);
      operations.push(...result.operations); added += result.added; edited += result.edited; deleted += result.deleted;
    }
    if (pendingEvents.length) await this.memory.saveCursor(userId, 'L2', 'events', [...new Set([...seenEvents, ...pendingEvents.map((event) => event.id)])]);

    const currentL2 = await this.memory.listEntries(userId, { layer: 'L2', includeArchived: false });
    const l3Cursor = await this.memory.getCursor(userId, 'L3', 'entries');
    const seenL2 = new Set(l3Cursor?.seenRefs ?? []);
    const pendingL2 = currentL2.filter((entry) => !seenL2.has(entry.id));
    for (const entryChunk of chunk(pendingL2, 24)) {
      const generated = model ? parseOperations(await model({ userId, events: [], entries: entryChunk })) : [];
      const result = await this.apply(userId, generated, 'L3', [], currentL2);
      operations.push(...result.operations); added += result.added; edited += result.edited; deleted += result.deleted;
    }
    if (pendingL2.length) await this.memory.saveCursor(userId, 'L3', 'entries', [...new Set([...seenL2, ...pendingL2.map((entry) => entry.id)])]);
    return { processed: pendingEvents.length, promoted: pendingL2.length, added, edited, deleted, operations };
  }

  private async apply(userId: string, input: MemoryConsolidationOperation[], target: 'L2' | 'L3', events: readonly any[], sourceEntries: readonly any[]) {
    const eventIds = new Set(events.map((event) => event.id)); const sourceIds = new Set(sourceEntries.map((entry) => entry.id));
    let added = 0; let edited = 0; let deleted = 0; const operations: MemoryConsolidationOperation[] = [];
    for (const operation of input) {
      if (operation.op === 'add') {
        if (operation.layer !== target || (target === 'L2' ? !operation.surface || operation.slot : !operation.slot || operation.surface)) continue;
        if (target === 'L3' && operation.slot === 'preferences') continue;
        const refs = operation.refs.filter((ref) => target === 'L2' ? eventIds.has(ref) : sourceIds.has(ref)); if (!refs.length) continue;
        await this.memory.createEntry(userId, { layer: target, surface: target === 'L2' ? operation.surface : undefined, slot: target === 'L3' ? operation.slot : undefined, section: operation.section, text: operation.text, refs }); added++; operations.push(operation);
      } else {
        const entry = await this.memory.getEntry(userId, operation.id).catch(() => null); if (!entry || entry.layer !== target) continue;
        if (operation.op === 'edit') {
          const refs = operation.refs?.filter((ref) => target === 'L2' ? eventIds.has(ref) : sourceIds.has(ref)); if (operation.refs && !refs?.length) continue;
          await this.memory.updateEntry(userId, operation.id, { ...(operation.text !== undefined ? { text: operation.text } : {}), ...(operation.section !== undefined ? { section: operation.section } : {}), ...(refs ? { refs } : {}) }); edited++; operations.push(operation);
        } else { await this.memory.updateEntry(userId, operation.id, { status: 'archived' }); deleted++; operations.push(operation); }
      }
    }
    return { added, edited, deleted, operations };
  }
}
