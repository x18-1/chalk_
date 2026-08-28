import { describe, expect, it } from 'vitest';

import { createDiscussionOutputParser } from '../../src/modules/classroom-discussions/services/classroom-discussion-output';

describe('classroom discussion structured output parser', () => {
  it('preserves interleaved Chalkboard actions and spoken text across arbitrary chunks', () => {
    const parser = createDiscussionOutputParser();
    const events = [
      ...parser.push('[{"type":"action","name":"wb_open","params":{}},{"type":"action","name":"wb_draw_latex","params":{"elementId":"formula","latex":"x+3=8",'),
      ...parser.push('"x":100,"y":80}},{"type":"text","content":"我们先看等式两边。"}]'),
      ...parser.finish(),
    ];

    expect(events).toEqual([
      { type: 'action', actionId: expect.any(String), actionName: 'wb_open', params: {} },
      {
        type: 'action',
        actionId: expect.any(String),
        actionName: 'wb_draw_latex',
        params: { elementId: 'formula', latex: 'x+3=8', x: 100, y: 80 },
      },
      { type: 'text_delta', delta: '我们先看等式两边。' },
    ]);
  });

  it('keeps plain model speech as a compatibility fallback', () => {
    const parser = createDiscussionOutputParser();
    expect(parser.push('先把等式想成天平。')).toEqual([]);
    expect(parser.finish()).toEqual([{ type: 'text_delta', delta: '先把等式想成天平。' }]);
  });

  it('never leaks malformed structured residue into student-visible speech', () => {
    const parser = createDiscussionOutputParser();
    parser.push('[{"type":"action","name":"wb_draw_text","params":');
    expect(parser.finish()).toEqual([]);
  });
});
