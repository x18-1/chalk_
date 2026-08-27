import { describe, expect, it } from 'vitest';

import { slideGenerationResultSchema } from '../../src/modules/classroom-generation/schemas';

describe('classroom generation schemas', () => {
  it('accepts only slide element types produced by the centralized generation prompt', () => {
    const supportedTypes = ['text', 'shape', 'line', 'chart', 'latex', 'table', 'image', 'video'];

    expect(slideGenerationResultSchema.safeParse({
      elements: supportedTypes.map((type, index) => ({ id: `element-${index}`, type })),
    }).success).toBe(true);

    expect(slideGenerationResultSchema.safeParse({
      elements: [{ id: 'silent-regression', type: 'future-widget' }],
    }).success).toBe(false);
  });
});
