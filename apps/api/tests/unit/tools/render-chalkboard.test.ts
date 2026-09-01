import { describe, expect, it } from 'vitest';

import {
  createRenderChalkboardTool,
  RENDER_CHALKBOARD_PROMPT,
} from '../../../src/agent/tools/render-chalkboard/tool';

describe('render_chalkboard tool feature', () => {
  it('exports an English model-facing prompt from its feature folder', () => {
    const tool = createRenderChalkboardTool();

    expect(tool.description).toBe(RENDER_CHALKBOARD_PROMPT);
    expect(tool.description).toMatch(/^Use render_chalkboard/);
    expect(tool.description).toContain('one fixed question schema');
  });

  it('declares a read-only sequential tool with bounded output', () => {
    const tool = createRenderChalkboardTool();

    expect(tool).toMatchObject({
      name: 'render_chalkboard',
      source: 'chalk',
      effects: ['read'],
      approvalPolicy: 'none',
      executionMode: 'sequential',
      defaultEnabled: true,
      limits: { maxResultCharacters: 2_000, maxUpdateCharacters: 1_000 },
    });
  });

  it('normalizes common diagram aliases and keeps multiline card text inside its card', async () => {
    const tool = createRenderChalkboardTool();
    const result = await tool.execute({
      title: '路线图',
      content: {
        type: 'slide',
        canvas: {
          viewportSize: 1000,
          viewportRatio: 1.7778,
          background: '#fff',
          elements: [
            { type: 'shape', shapeType: 'circle', x: 100, y: 160, width: 40, height: 40, fill: '#14532d' },
            { type: 'shape', shape: 'ellipse', x: 150, y: 160, width: 80, height: 40, fill: 'none', stroke: '#14532d', strokeWidth: 3 },
            { type: 'shape', shape: 'rect', x: 200, y: 160, width: 30, height: 60, fill: '#3f7bd8' },
            { type: 'shape', shape: 'polygon', points: [[250, 160], [260, 170], [250, 180]], fill: '#4a5b75' },
            { type: 'text', x: 120, y: 262, text: '认识界面\n单元格与输入\n工作表管理', textAlign: 'center', fontSize: 13 },
            { type: 'text', x: 215, y: 274, text: '→', textAlign: 'center', fontSize: 20 },
          ],
        },
      },
    }, {} as never);
    const elements = result.details.scene.content.canvas?.elements as Array<Record<string, unknown>>;
    expect(elements[0]).toMatchObject({ shape: 'circle', viewBox: [40, 40], left: 100, top: 160 });
    expect(elements[1]).toMatchObject({ shape: 'ellipse', viewBox: [80, 40], left: 150, top: 160, outline: { color: '#14532d', width: 3 }, path: 'M 40 0 A 40 20 0 1 1 40 40 A 40 20 0 1 1 40 0 Z' });
    expect(elements[2]).toMatchObject({ shape: 'rect', viewBox: [30, 60], path: 'M 0 0 H 30 V 60 H 0 Z' });
    expect(elements[3]).toMatchObject({ shape: 'polygon', left: 250, top: 160, width: 10, height: 20, viewBox: [10, 20], path: 'M 0 0 L 10 10 L 0 20 Z' });
    expect(elements[4]).toMatchObject({ align: 'center' });
    expect(elements[4]!.width as number).toBeCloseTo(110.4);
    expect(elements[4]!.height as number).toBeCloseTo(85.6);
    expect(elements[4]!.left as number).toBeCloseTo(64.8);
    expect(elements[5]).toMatchObject({ align: 'center' });
    expect(elements[5]!.width as number).toBeCloseTo(42);
    expect(elements[5]!.left as number).toBeCloseTo(194);
  });

  it('returns only content accepted by the canonical Chalkboard Scene schema', async () => {
    const tool = createRenderChalkboardTool();
    const result = await tool.execute({
      title: '交互演示',
      content: { type: 'interactive', html: '<canvas id="lesson"></canvas>' },
    }, {} as never);

    expect(result.details.scene.content).toMatchObject({
      type: 'interactive',
      html: '<canvas id="lesson"></canvas>',
    });
  });

  it('normalizes legacy quiz aliases into the canonical question contract', async () => {
    const tool = createRenderChalkboardTool();
    const result = await tool.execute({
      title: '检查点',
      content: {
        type: 'quiz',
        questions: [{
          prompt: '哪一个选项正确？',
          options: ['正确', '错误'],
          correctIndex: 0,
          explanation: '根据定义可知。',
        }],
      },
    }, {} as never);

    expect(result.details.scene.content.questions).toEqual([expect.objectContaining({
      id: 'q1',
      type: 'single',
      question: '哪一个选项正确？',
      options: [{ value: 'A', label: '正确' }, { value: 'B', label: '错误' }],
      answer: ['A'],
      analysis: '根据定义可知。',
    })]);
  });
});
