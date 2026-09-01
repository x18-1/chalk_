import type { Database } from '../../../db/client';
import { createAgentSettingsDal } from '../../../db/dal/agent-settings';
import { createMemoryDal, type CreateMemoryEventInput, type CreateMemoryEntryInput, type MemoryLayer } from '../../../db/dal/memory';
import { OwnershipError } from '../../../db/errors';

const L3_SLOTS = ['recent', 'profile', 'scope', 'preferences'] as const;

function renderMemory(entries: Array<{ layer: string; surface: string | null; slot: string | null; section: string; text: string }>) {
  const l3 = entries.filter((entry) => entry.layer === 'L3' && entry.slot);
  if (!l3.length) return '(No memory available.)';
  return L3_SLOTS.flatMap((slot) => {
    const slotEntries = l3.filter((entry) => entry.slot === slot);
    if (!slotEntries.length) return [];
    return [`## ${slot}`, ...slotEntries.map((entry) => `- ${entry.text}`)];
  }).join('\n');
}

export class MemoryService {
  private readonly memory;
  private readonly settings;

  constructor(db: Database) {
    this.memory = createMemoryDal(db);
    this.settings = createAgentSettingsDal(db);
  }

  async read(userId: string, options: { includeArchived?: boolean } = {}) {
    const entries = await this.memory.listEntries(userId, {
      layer: 'L3',
      includeArchived: options.includeArchived ?? false,
    });
    return { text: renderMemory(entries), entries };
  }

  async promptContext(userId: string) {
    const settings = await this.settings.get(userId);
    if (!(settings?.memoryInjectionEnabled ?? true)) return '';
    const result = await this.read(userId);
    if (!result.entries.length) return '';
    return `## memory\n${result.text.slice(0, 8_000)}`;
  }

  listEntries(userId: string, options: { layer?: MemoryLayer; surface?: string; slot?: string; includeArchived?: boolean } = {}) {
    return this.memory.listEntries(userId, options);
  }

  getEntry(userId: string, entryId: string) {
    return this.memory.getEntry(userId, entryId);
  }

  async createEntry(userId: string, input: CreateMemoryEntryInput) {
    await this.validateRefs(userId, input);
    return this.memory.createEntry(userId, input);
  }

  private async validateRefs(userId: string, input: CreateMemoryEntryInput) {
    for (const ref of input.refs ?? []) {
      try {
        if (input.layer === 'L2') await this.memory.getEvent(userId, ref);
        else {
          const entry = await this.memory.getEntry(userId, ref);
          if (entry.layer !== 'L2') throw new Error('wrong layer');
        }
      } catch {
        throw new OwnershipError('memory reference', ref);
      }
    }
  }

  updateEntry(userId: string, entryId: string, input: Parameters<ReturnType<typeof createMemoryDal>['updateEntry']>[2]) {
    return this.memory.updateEntry(userId, entryId, input);
  }

  appendEvent(userId: string, input: CreateMemoryEventInput) {
    return this.memory.appendEvent(userId, input);
  }

  listEvents(userId: string, options: Parameters<ReturnType<typeof createMemoryDal>['listEvents']>[1] = {}) {
    return this.memory.listEvents(userId, options);
  }

  listEventOwners() { return this.memory.listEventOwners(); }
  latestEvent(userId: string) { return this.memory.latestEvent(userId); }
  async hasPendingWork(userId: string) {
    const events = await this.memory.listEvents(userId, { limit: 5_000 });
    const l2Cursor = await this.memory.getCursor(userId, 'L2', 'events');
    if (events.some((event) => !(l2Cursor?.seenRefs ?? []).includes(event.id))) return true;
    const l2Entries = await this.memory.listEntries(userId, { layer: 'L2' });
    const l3Cursor = await this.memory.getCursor(userId, 'L3', 'entries');
    return l2Entries.some((entry) => !(l3Cursor?.seenRefs ?? []).includes(entry.id));
  }

  getCursor(userId: string, layer: MemoryLayer, key: string) {
    return this.memory.getCursor(userId, layer, key);
  }

  saveCursor(userId: string, layer: MemoryLayer, key: string, seenRefs: readonly string[]) {
    return this.memory.saveCursor(userId, layer, key, seenRefs);
  }

  enqueueConsolidation(userId: string) { return this.memory.enqueueRun(userId); }
  claimConsolidation(workerId: string) { return this.memory.claimRun(workerId); }
  finishConsolidation(userId: string, runId: string, status: 'completed' | 'failed', error?: string) { return this.memory.finishRun(userId, runId, status, error); }
  listConsolidationRuns(userId: string, limit?: number) { return this.memory.listRuns(userId, limit); }

  async writePreference(userId: string, input: { text: string; slot?: 'preferences' | 'profile'; reason?: string | null }) {
    const event = await this.memory.appendEvent(userId, {
      surface: 'chat',
      kind: 'preference_stated',
      payload: { text: input.text, reason: input.reason ?? null },
    });
    const existing = await this.memory.listEntries(userId, { layer: 'L3', slot: input.slot ?? 'preferences' });
    const duplicate = existing.find((entry) => entry.text.trim().toLocaleLowerCase() === input.text.trim().toLocaleLowerCase());
    if (duplicate) return { entry: duplicate, event, deduplicated: true };
    // Explicit learner-authored preferences retain a direct L1 trace reference;
    // model-driven consolidation still enforces the L3 -> L2 graph.
    const entry = await this.memory.createEntry(userId, {
      layer: 'L3', slot: input.slot ?? 'preferences', section: 'Preferences', text: input.text, refs: [event.id],
    });
    return { entry, event, deduplicated: false };
  }

  async editPreference(userId: string, entryId: string, input: { text: string; section?: string }) {
    const entry = await this.memory.getEntry(userId, entryId);
    if (entry.layer !== 'L3' || !entry.slot || !['preferences', 'profile'].includes(entry.slot)) throw new OwnershipError('memory entry', entryId);
    return this.memory.updateEntry(userId, entryId, { text: input.text, ...(input.section ? { section: input.section } : {}) });
  }
}
