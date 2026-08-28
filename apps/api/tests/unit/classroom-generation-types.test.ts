import { describe, expect, it, vi } from 'vitest';

import { streamWithAbort } from '../../src/modules/classroom-generation/services/classroom-generation.types';

describe('streamWithAbort', () => {
  it('stops promptly when a provider leaves next() pending after abort', async () => {
    const controller = new AbortController();
    const returnIterator = vi.fn(() => Promise.resolve({ done: true as const, value: undefined }));
    const source: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<string>>(() => undefined),
          return: returnIterator,
        };
      },
    };
    const iterator = streamWithAbort(source, controller.signal)[Symbol.asyncIterator]();
    const pending = iterator.next();
    const reason = new Error('worker stopped');

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
    expect(returnIterator).toHaveBeenCalledOnce();
  });
});
