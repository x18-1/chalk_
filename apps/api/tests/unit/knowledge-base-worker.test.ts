import { describe, expect, it, vi } from 'vitest';

import { LocalIndexQueue } from '../../src/modules/knowledge-bases/services/knowledge-base.service';

const job = (documentId: string) => ({
  userId: 'user-1',
  knowledgeBaseId: 'kb-1',
  documentId,
});

describe('local knowledge-base index queue', () => {
  it('processes jobs in order and keeps running after a failed job', async () => {
    const processed: string[] = [];
    const queue = new LocalIndexQueue(async (item) => {
      if (item.documentId === 'failed') throw new Error('provider unavailable');
      processed.push(item.documentId);
    });

    queue.enqueue(job('failed'));
    queue.enqueue(job('second'));
    queue.enqueue(job('third'));

    await vi.waitFor(() => expect(processed).toEqual(['second', 'third']));
    queue.stop();
  });

  it('does not enqueue the same document more than once while pending', async () => {
    const processed: string[] = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const queue = new LocalIndexQueue(async (item) => {
      await blocked;
      processed.push(item.documentId);
    });

    queue.enqueue(job('same'));
    queue.enqueue(job('same'));
    release();

    await vi.waitFor(() => expect(processed).toEqual(['same']));
    queue.stop();
  });
});
