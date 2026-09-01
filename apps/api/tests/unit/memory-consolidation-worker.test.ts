import { describe, expect, it, vi } from 'vitest';
import { MemoryConsolidationWorker } from '../../src/modules/memory/services/memory-consolidation.worker';

function fixture(latestEventAt: Date, seenRefs: string[] = []) {
  const run = { id: 'run-1', userId: 'user-1' };
  const memory = {
    claimConsolidation: vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(run),
    listEventOwners: vi.fn(async () => [{ userId: 'user-1' }]),
    latestEvent: vi.fn(async () => ({ occurredAt: latestEventAt })),
    hasPendingWork: vi.fn(async () => seenRefs.length < 2),
    enqueueConsolidation: vi.fn(async () => run),
    finishConsolidation: vi.fn(async () => undefined),
  } as any;
  const consolidation = { run: vi.fn(async () => ({ processed: 2 })) } as any;
  return { memory, consolidation, run };
}

describe('MemoryConsolidationWorker idle scheduling', () => {
  it('queues one batch after twenty minutes of inactivity', async () => {
    const { memory, consolidation, run } = fixture(new Date(Date.now() - 21 * 60_000));
    const worker = new MemoryConsolidationWorker(memory, consolidation, 60_000, 20 * 60_000);

    await (worker as any).drain();

    expect(memory.enqueueConsolidation).toHaveBeenCalledWith('user-1');
    expect(consolidation.run).toHaveBeenCalledWith('user-1');
    expect(memory.finishConsolidation).toHaveBeenCalledWith('user-1', run.id, 'completed');
  });

  it('does not queue while the learner is active', async () => {
    const { memory, consolidation } = fixture(new Date(Date.now() - 19 * 60_000));
    const worker = new MemoryConsolidationWorker(memory, consolidation, 60_000, 20 * 60_000);

    await (worker as any).drain();

    expect(memory.enqueueConsolidation).not.toHaveBeenCalled();
    expect(consolidation.run).not.toHaveBeenCalled();
  });

  it('does not queue an idle owner whose L1 cursor is current', async () => {
    const { memory, consolidation } = fixture(new Date(Date.now() - 21 * 60_000), ['event-1', 'event-2']);
    const worker = new MemoryConsolidationWorker(memory, consolidation, 60_000, 20 * 60_000);

    await (worker as any).drain();

    expect(memory.enqueueConsolidation).not.toHaveBeenCalled();
    expect(consolidation.run).not.toHaveBeenCalled();
  });
});
