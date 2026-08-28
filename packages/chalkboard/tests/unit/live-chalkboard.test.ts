import { describe, expect, it } from 'vitest';

import {
  applyLiveChalkboardCommand,
  describeChalkboardState,
  emptyChalkboardState,
} from '../../src/live-chalkboard.js';

describe('live Chalkboard module', () => {
  it('validates and applies a sequence through one stateful interface', () => {
    const opened = applyLiveChalkboardCommand(emptyChalkboardState(), {
      id: 'open-1',
      type: 'wb_open',
    });
    expect(opened).toMatchObject({ ok: true, state: { open: true, elements: [] } });
    if (!opened.ok) return;

    const drawn = applyLiveChalkboardCommand(opened.state, {
      id: 'formula-action',
      type: 'wb_draw_latex',
      elementId: 'balance-formula',
      latex: 'x + 3 = 8',
      x: 120,
      y: 90,
      width: 420,
    });
    expect(drawn).toMatchObject({
      ok: true,
      action: { type: 'wb_draw_latex', elementId: 'balance-formula' },
      state: { open: true, elements: [expect.objectContaining({ latex: 'x + 3 = 8' })] },
    });
  });

  it('rejects unknown element mutations and overlapping element identities', () => {
    const first = applyLiveChalkboardCommand(emptyChalkboardState(), {
      id: 'first',
      type: 'wb_draw_text',
      elementId: 'step-1',
      content: '第一步',
      x: 80,
      y: 80,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    expect(applyLiveChalkboardCommand(first.state, {
      id: 'duplicate',
      type: 'wb_draw_text',
      elementId: 'step-1',
      content: '覆盖第一步',
      x: 80,
      y: 160,
    })).toEqual({ ok: false, reason: 'element_id_conflict' });

    expect(applyLiveChalkboardCommand(first.state, {
      id: 'delete-missing',
      type: 'wb_delete',
      elementId: 'missing',
    })).toEqual({ ok: false, reason: 'element_not_found' });
  });

  it('applies line-level code edits and exposes the updated board to later Agents', () => {
    const drawn = applyLiveChalkboardCommand(emptyChalkboardState(), {
      id: 'code-draw',
      type: 'wb_draw_code',
      elementId: 'example-code',
      language: 'typescript',
      code: 'const left = x + 3;\nconst right = 8;',
      x: 80,
      y: 80,
      width: 560,
      height: 260,
    });
    expect(drawn.ok).toBe(true);
    if (!drawn.ok) return;

    const edited = applyLiveChalkboardCommand(drawn.state, {
      id: 'code-edit',
      type: 'wb_edit_code',
      elementId: 'example-code',
      operation: 'insert_after',
      lineId: 'L1',
      content: 'const next = left - 3;',
    });
    expect(edited).toMatchObject({
      ok: true,
      state: { elements: [expect.objectContaining({
        code: 'const left = x + 3;\nconst next = left - 3;\nconst right = 8;',
        lineIds: ['L1', 'code-edit-line-1', 'L2'],
      })] },
    });
    if (!edited.ok) return;
    expect(describeChalkboardState(edited.state)).toContain('example-code');
    expect(describeChalkboardState(edited.state)).toContain('const next = left - 3;');
    expect(applyLiveChalkboardCommand(edited.state, {
      id: 'bad-code-edit',
      type: 'wb_edit_code',
      elementId: 'example-code',
      operation: 'delete_lines',
      lineIds: ['missing-line'],
    })).toEqual({ ok: false, reason: 'code_line_not_found' });
  });

  it('rejects invalid coordinates instead of letting the model draw off-canvas', () => {
    expect(applyLiveChalkboardCommand(emptyChalkboardState(), {
      id: 'offscreen',
      type: 'wb_draw_shape',
      shape: 'rectangle',
      x: 1_200,
      y: 90,
      width: 200,
      height: 100,
    })).toEqual({ ok: false, reason: 'invalid_params' });
  });

  it('rejects elements whose bounds extend beyond the canvas', () => {
    expect(applyLiveChalkboardCommand(emptyChalkboardState(), {
      id: 'overflowing-shape',
      type: 'wb_draw_shape',
      shape: 'rectangle',
      x: 900,
      y: 500,
      width: 180,
      height: 80,
    })).toEqual({ ok: false, reason: 'invalid_params' });
  });

  it('rejects ragged table data before it reaches the renderer', () => {
    expect(applyLiveChalkboardCommand(emptyChalkboardState(), {
      id: 'ragged-table',
      type: 'wb_draw_table',
      x: 20,
      y: 20,
      width: 400,
      height: 200,
      data: [['a', 'b'], ['c']],
    })).toEqual({ ok: false, reason: 'invalid_params' });
  });
});
