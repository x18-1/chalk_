import { describe, expect, it } from 'vitest';
import { memoryEntryCreateSchema } from '../../src/modules/memory/schemas';

describe('memory entry schemas', () => {
  it('enforces DeepTutor scope invariants before reaching the database', () => {
    expect(() => memoryEntryCreateSchema.parse({ layer: 'L2', slot: 'profile', section: 'x', text: 'y' })).toThrow();
    expect(() => memoryEntryCreateSchema.parse({ layer: 'L3', surface: 'chat', section: 'x', text: 'y' })).toThrow();
    expect(memoryEntryCreateSchema.parse({ layer: 'L3', slot: 'profile', section: 'Profile', text: 'y' })).toMatchObject({ layer: 'L3', slot: 'profile' });
  });
});
