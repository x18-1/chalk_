import { randomUUID } from 'node:crypto';
import type { MemoryService } from './memory.service';
import { MemoryConsolidationService } from './memory-consolidation.service';

export class MemoryConsolidationWorker {
  private readonly id = randomUUID();
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  // Memory is intentionally consolidated only after an idle period. This
  // keeps normal chat turns cheap while still making the backlog durable.
  constructor(private readonly memory: MemoryService, private readonly consolidation: MemoryConsolidationService, private readonly intervalMs = 60_000, private readonly idleMs = 20 * 60_000) {}
  start() { if (this.timer) return; this.timer = setInterval(() => void this.drain(), this.intervalMs); this.timer.unref(); void this.drain(); }
  async stop() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  wake() { void this.drain(); }
  private async drain() {
    if (this.running) return; this.running = true;
    try {
      // First claim explicitly queued/manual runs.
      let run = await this.memory.claimConsolidation(this.id);
      if (run) {
        await this.execute(run);
        return;
      }
      // Then enqueue only users whose latest activity has been idle for the
      // configured window and who still have unseen L1 events.
      const cutoff = Date.now() - this.idleMs;
      for (const { userId } of await this.memory.listEventOwners()) {
        const latest = await this.memory.latestEvent(userId);
        if (!latest || latest.occurredAt.getTime() > cutoff) continue;
        if (!(await this.memory.hasPendingWork(userId))) continue;
        await this.memory.enqueueConsolidation(userId).catch(() => undefined);
        run = await this.memory.claimConsolidation(this.id);
        if (run) { await this.execute(run); return; }
      }
    } finally { this.running = false; }
  }

  private async execute(run: { id: string; userId: string }) {
    try { await this.consolidation.run(run.userId); await this.memory.finishConsolidation(run.userId, run.id, 'completed'); }
    catch (error) { await this.memory.finishConsolidation(run.userId, run.id, 'failed', error instanceof Error ? error.message : String(error)).catch(() => undefined); }
  }
}
