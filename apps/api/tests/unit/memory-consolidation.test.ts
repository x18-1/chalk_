import { describe, expect, it, vi } from 'vitest';
import { MemoryConsolidationService } from '../../src/modules/memory/services/memory-consolidation.service';

function fixture() {
  const events = [{ id: 'e1', surface: 'chat', kind: 'message', payload: { text: 'I prefer worked examples' } }];
  const memory = {
    listEvents: vi.fn(async () => events),
    getCursor: vi.fn(async () => null),
    listEntries: vi.fn(async () => []),
    createEntry: vi.fn(async (_user: string, input: any) => ({ id: 'm1', ...input })),
    updateEntry: vi.fn(),
    saveCursor: vi.fn(async () => undefined),
  } as any;
  return { memory, events };
}

describe('MemoryConsolidationService', () => {
  it('creates bounded auditable L2 entries from unprocessed events', async () => {
    const { memory } = fixture();
    const result = await new MemoryConsolidationService(memory).run('u1');
    expect(result).toMatchObject({ processed: 1, added: 1 });
    expect(memory.createEntry).toHaveBeenCalledWith('u1', expect.objectContaining({ layer: 'L2', surface: 'chat', refs: ['e1'] }));
    expect(memory.saveCursor).toHaveBeenCalledWith('u1', 'L2', 'events', ['e1']);
  });

  it('accepts only constrained model operations and ignores preference promotion', async () => {
    const { memory } = fixture();
    const model = vi.fn(async () => [{ op: 'add', layer: 'L3', slot: 'preferences', section: 'Preferences', text: 'invented', refs: ['e1'] }, { op: 'add', layer: 'L3', slot: 'profile', section: 'Profile', text: 'durable', refs: ['missing'] }]);
    const result = await new MemoryConsolidationService(memory, model).run('u1');
    expect(result.added).toBe(0);
    expect(memory.createEntry).not.toHaveBeenCalled();
  });

  it('accepts the operation field used by the configured consolidation model', async () => {
    const { memory } = fixture();
    const model = vi.fn(async () => [{
      operation: 'add',
      layer: 'L2',
      surface: 'chat',
      section: 'learning_style',
      text: '喜欢通过例题学习数学',
      refs: ['e1'],
    }]);

    const result = await new MemoryConsolidationService(memory, model).run('u1');

    expect(result).toMatchObject({ processed: 1, added: 1 });
    expect(memory.createEntry).toHaveBeenCalledWith('u1', expect.objectContaining({
      layer: 'L2',
      surface: 'chat',
      refs: ['e1'],
    }));
  });

  it('does not process events already recorded by the cursor', async () => {
    const { memory } = fixture(); memory.getCursor.mockResolvedValue({ seenRefs: ['e1'] });
    const result = await new MemoryConsolidationService(memory).run('u1');
    expect(result.processed).toBe(0);
    expect(memory.saveCursor).not.toHaveBeenCalled();
  });
});
