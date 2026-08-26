import type { StageDocument } from '../../src/schema.js';

/**
 * Reduced from OpenMAIC's equation-properties fixture at 1466a55e.
 * It keeps the real Stage -> Scene -> Action envelope and representative
 * slide, interactive, quiz, and unsupported PBL scenes used by the runtime.
 */
export const openMaicStageFixture: StageDocument = {
  stage: {
    id: 'stage-equation-properties-v1',
    name: '等式的性质与移项为什么要变号',
    description: '从天平直观、等式操作到移项规则。',
    createdAt: 1785974400000,
    updatedAt: 1785974400000,
    languageDirective: '使用简体中文，面向七年级学生。',
    style: 'clear-classroom',
  },
  scenes: [
    {
      id: 'scene-balance',
      stageId: 'stage-equation-properties-v1',
      type: 'slide',
      title: '等式像一架平衡的天平',
      order: 0,
      content: {
        type: 'slide',
        schemaVersion: 1,
        canvas: { id: 'canvas-balance', viewportSize: 1000, viewportRatio: 0.5625, elements: [] },
      },
      actions: [
        { id: 'a-intro', type: 'speech', text: '等号表示左右两边的量相等。' },
        { id: 'a-focus', type: 'spotlight', elementId: 'balance-image' },
      ],
    },
    {
      id: 'scene-operation',
      stageId: 'stage-equation-properties-v1',
      type: 'interactive',
      title: '亲手保持等式平衡',
      order: 1,
      content: { type: 'interactive', url: 'https://example.test/equation-balance' },
      actions: [{ id: 'a-operation', type: 'speech', text: '两边同时减去 3。' }],
    },
    {
      id: 'scene-check',
      stageId: 'stage-equation-properties-v1',
      type: 'quiz',
      title: '检查你是否理解',
      order: 2,
      content: { type: 'quiz', questions: [] },
    },
    {
      id: 'scene-pbl',
      stageId: 'stage-equation-properties-v1',
      type: 'pbl',
      title: '项目课',
      order: 3,
      content: { type: 'pbl', projectConfig: {} },
    },
  ],
};
