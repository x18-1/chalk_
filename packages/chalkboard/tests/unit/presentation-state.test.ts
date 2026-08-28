import { describe, expect, it } from 'vitest';
import { projectScenePresentation } from '../../src/presentation-state.js';

describe('scene presentation projection', () => {
  it('rebuilds only stateful actions before the restored cursor', () => {
    const actions = [
      { id: 'speech', type: 'speech', text: '不要重复朗读' },
      { id: 'open', type: 'wb_open' },
      { id: 'note', type: 'wb_draw_text', elementId: 'note-1', content: 'x + 3 = 8', x: 80, y: 100 },
      { id: 'state', type: 'widget_setState', state: { value: 5 } },
      { id: 'question', type: 'discussion', topic: '两边为什么要同时减 3？' },
      { id: 'future', type: 'widget_reveal', target: '#answer' },
    ];

    expect(projectScenePresentation(actions, 5)).toEqual({
      discussion: '两边为什么要同时减 3？',
      widget: {
        highlightTarget: null,
        state: { value: 5 },
        annotation: null,
        revealTarget: null,
      },
      liveChalkboard: {
        open: true,
        elements: [expect.objectContaining({ id: 'note', elementId: 'note-1', type: 'wb_draw_text' })],
      },
    });
  });

  it('applies Live Chalkboard clear, delete, and close semantics deterministically', () => {
    const actions = [
      { id: 'first', type: 'wb_draw_text', elementId: 'first', content: '旧内容', x: 10, y: 10 },
      { id: 'clear', type: 'wb_clear' },
      { id: 'second', type: 'wb_draw_latex', elementId: 'formula', latex: 'x=5', x: 40, y: 50 },
      { id: 'third', type: 'wb_draw_line', elementId: 'line', startX: 0, startY: 0, endX: 100, endY: 100 },
      { id: 'delete', type: 'wb_delete', elementId: 'line' },
      { id: 'close', type: 'wb_close' },
    ];

    expect(projectScenePresentation(actions, actions.length).liveChalkboard).toEqual({
      open: false,
      elements: [expect.objectContaining({ id: 'second', elementId: 'formula' })],
    });
  });
});
