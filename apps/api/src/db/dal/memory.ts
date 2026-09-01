import { and, asc, desc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import type { Database } from '../client';
import { AuthRequiredError, OwnershipError } from '../errors';
import { memoryConsolidationRuns, memoryCursors, memoryEntries, memoryEvents } from '../schema';

function requireUserId(userId: string) {
  if (!userId) throw new AuthRequiredError();
}

export type MemoryLayer = 'L2' | 'L3';
export type CreateMemoryEventInput = {
  surface: string; kind: string; payload: unknown;
  sourceType?: string | null; sourceId?: string | null; fingerprint?: string | null; occurredAt?: Date;
};
export type CreateMemoryEntryInput = {
  layer: MemoryLayer; surface?: string; slot?: string; section: string; text: string;
  refs?: readonly string[]; status?: 'active' | 'archived';
};

/** Deep module seam for all owner-scoped memory persistence. */
export function createMemoryDal(db: Database) {
  return {
    async appendEvent(userId: string, input: CreateMemoryEventInput) {
      requireUserId(userId);
      const rows = await db.insert(memoryEvents).values({
        userId, surface: input.surface, kind: input.kind, payload: input.payload,
        sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null,
        fingerprint: input.fingerprint ?? null,
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      }).returning();
      return rows[0]!;
    },
    async listEvents(userId: string, options: { surface?: string; limit?: number; before?: Date } = {}) {
      requireUserId(userId);
      const filters = [eq(memoryEvents.userId, userId)];
      if (options.surface) filters.push(eq(memoryEvents.surface, options.surface));
      if (options.before) filters.push(lt(memoryEvents.occurredAt, options.before));
      return db.select().from(memoryEvents).where(and(...filters)).orderBy(asc(memoryEvents.occurredAt)).limit(options.limit ?? 100);
    },
    async listEventOwners() {
      return db.selectDistinct({ userId: memoryEvents.userId }).from(memoryEvents);
    },
    async latestEvent(userId: string) {
      requireUserId(userId);
      const rows = await db.select({ occurredAt: memoryEvents.occurredAt })
        .from(memoryEvents).where(eq(memoryEvents.userId, userId))
        .orderBy(desc(memoryEvents.occurredAt)).limit(1);
      return rows[0] ?? null;
    },
    async getEvent(userId: string, eventId: string) {
      requireUserId(userId);
      const rows = await db.select().from(memoryEvents).where(and(eq(memoryEvents.id, eventId), eq(memoryEvents.userId, userId))).limit(1);
      if (!rows[0]) throw new OwnershipError('memory event', eventId);
      return rows[0];
    },
    async listEntries(userId: string, options: { layer?: MemoryLayer; surface?: string; slot?: string; includeArchived?: boolean } = {}) {
      requireUserId(userId);
      const filters = [eq(memoryEntries.userId, userId)];
      if (options.layer) filters.push(eq(memoryEntries.layer, options.layer));
      if (options.surface) filters.push(eq(memoryEntries.surface, options.surface));
      if (options.slot) filters.push(eq(memoryEntries.slot, options.slot));
      if (!options.includeArchived) filters.push(eq(memoryEntries.status, 'active'));
      return db.select().from(memoryEntries).where(and(...filters)).orderBy(asc(memoryEntries.layer), asc(memoryEntries.updatedAt));
    },
    async getEntry(userId: string, entryId: string) {
      requireUserId(userId);
      const rows = await db.select().from(memoryEntries).where(and(eq(memoryEntries.id, entryId), eq(memoryEntries.userId, userId))).limit(1);
      if (!rows[0]) throw new OwnershipError('memory entry', entryId);
      return rows[0];
    },
    async createEntry(userId: string, input: CreateMemoryEntryInput) {
      requireUserId(userId);
      const rows = await db.insert(memoryEntries).values({
        userId, layer: input.layer, surface: input.surface ?? null, slot: input.slot ?? null,
        section: input.section, text: input.text, refs: [...(input.refs ?? [])], status: input.status ?? 'active',
      }).returning();
      return rows[0]!;
    },
    async updateEntry(userId: string, entryId: string, input: { text?: string; section?: string; refs?: readonly string[]; status?: 'active' | 'archived' }) {
      requireUserId(userId);
      const rows = await db.update(memoryEntries).set({
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.section !== undefined ? { section: input.section } : {}),
        ...(input.refs !== undefined ? { refs: [...input.refs] } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        version: sql`${memoryEntries.version} + 1`, updatedAt: new Date(),
      }).where(and(eq(memoryEntries.id, entryId), eq(memoryEntries.userId, userId))).returning();
      if (!rows[0]) throw new OwnershipError('memory entry', entryId);
      return rows[0];
    },
    async getCursor(userId: string, layer: MemoryLayer, key: string) {
      requireUserId(userId);
      const rows = await db.select().from(memoryCursors).where(and(eq(memoryCursors.userId, userId), eq(memoryCursors.layer, layer), eq(memoryCursors.key, key))).limit(1);
      return rows[0] ?? null;
    },
    async saveCursor(userId: string, layer: MemoryLayer, key: string, seenRefs: readonly string[]) {
      requireUserId(userId);
      const now = new Date();
      const rows = await db.insert(memoryCursors).values({ userId, layer, key, seenRefs: [...seenRefs], updatedAt: now })
        .onConflictDoUpdate({ target: [memoryCursors.userId, memoryCursors.layer, memoryCursors.key], set: { seenRefs: [...seenRefs], updatedAt: now } }).returning();
      return rows[0]!;
    },
    async enqueueRun(userId: string) {
      requireUserId(userId);
      const existing = await db.select().from(memoryConsolidationRuns).where(and(eq(memoryConsolidationRuns.userId, userId), inArray(memoryConsolidationRuns.status, ['queued', 'running']))).limit(1);
      if (existing[0]) return existing[0];
      const rows = await db.insert(memoryConsolidationRuns).values({ userId }).returning();
      return rows[0]!;
    },
    async claimRun(workerId: string) {
      const rows = await db.transaction(async (tx) => {
        const staleBefore = new Date(Date.now() - 10 * 60_000);
        const candidates = await tx.select().from(memoryConsolidationRuns).where(or(eq(memoryConsolidationRuns.status, 'queued'), and(eq(memoryConsolidationRuns.status, 'running'), lte(memoryConsolidationRuns.startedAt, staleBefore)))).orderBy(asc(memoryConsolidationRuns.requestedAt)).limit(1).for('update', { skipLocked: true });
        const run = candidates[0];
        if (!run) return [];
        void workerId;
        return tx.update(memoryConsolidationRuns).set({ status: 'running', startedAt: new Date(), error: null }).where(and(eq(memoryConsolidationRuns.id, run.id), inArray(memoryConsolidationRuns.status, ['queued', 'running']))).returning();
      });
      return rows[0] ?? null;
    },
    async finishRun(userId: string, runId: string, status: 'completed' | 'failed', error?: string) {
      requireUserId(userId);
      const rows = await db.update(memoryConsolidationRuns).set({ status, finishedAt: new Date(), ...(error ? { error } : {}) }).where(and(eq(memoryConsolidationRuns.id, runId), eq(memoryConsolidationRuns.userId, userId), eq(memoryConsolidationRuns.status, 'running'))).returning();
      if (!rows[0]) throw new OwnershipError('memory consolidation run', runId);
      return rows[0];
    },
    async listRuns(userId: string, limit = 20) {
      requireUserId(userId);
      return db.select().from(memoryConsolidationRuns).where(eq(memoryConsolidationRuns.userId, userId)).orderBy(desc(memoryConsolidationRuns.requestedAt)).limit(limit);
    },
  };
}
