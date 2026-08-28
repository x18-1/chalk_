import { describe, expect, it } from 'vitest';

import { ApiError } from '../../src/http/errors';
import {
  MAX_OUTLINE_STREAM_BYTES,
  OutlineStreamParser,
  extractNewOutlineValues,
} from '../../src/modules/classroom-generation/services/outline-stream-parser';

describe('OutlineStreamParser', () => {
  it('emits only complete top-level objects across arbitrary chunk boundaries', () => {
    const source = JSON.stringify({
      languageDirective: '使用中文教学，并解释字符串中的 {括号}。',
      courseTitle: '分数加法',
      outlines: [{
        id: 'scene_1',
        type: 'slide',
        title: '同分母分数',
        description: '先理解单位相同。',
        keyPoints: ['分母不变', '分子相加'],
        order: 9,
      }, {
        id: 'scene_2',
        type: 'quiz',
        title: '检查理解',
        description: '完成一道选择题。',
        keyPoints: ['先判断分母'],
        order: 9,
        quizConfig: { questionCount: 1, difficulty: 'easy', questionTypes: ['single'] },
      }],
    });
    const parser = new OutlineStreamParser(undefined);
    const events = [];
    for (let offset = 0; offset < source.length; offset += 7) {
      events.push(...parser.push(source.slice(offset, offset + 7)));
    }

    expect(events.map((event) => event.type)).toEqual([
      'languageDirective',
      'courseTitle',
      'outline',
      'outline',
    ]);
    expect(events.filter((event) => event.type === 'outline').map((event) => event.data.order)).toEqual([1, 2]);
    expect(parser.finish().outlines).toHaveLength(2);
  });

  it('resumes scanning after a completed object without reparsing earlier values', () => {
    const first = '{"outlines":[{"id":"one","nested":{"value":"}"}}';
    const firstResult = extractNewOutlineValues(first, 0);
    expect(firstResult.outlines).toHaveLength(1);

    const secondResult = extractNewOutlineValues(`${first},{"id":"two"}]}`, firstResult.scanFrom);
    expect(secondResult.outlines).toEqual([{ id: 'two' }]);
  });

  it('rejects PBL before an outline event can be emitted', () => {
    const parser = new OutlineStreamParser(undefined);
    const action = () => parser.push(JSON.stringify({
      languageDirective: '中文',
      courseTitle: '项目课',
      outlines: [{
        id: 'scene_pbl',
        type: 'pbl',
        title: '项目',
        description: '不在 V3 范围内。',
        keyPoints: ['PBL'],
        order: 1,
        pblConfig: { project: 'model' },
      }],
    }));
    expectApiError(action, 'CLASSROOM_OUTLINE_TYPE_UNSUPPORTED');
  });

  it('bounds the accumulated model output', () => {
    const parser = new OutlineStreamParser(undefined);
    expectApiError(
      () => parser.push('x'.repeat(MAX_OUTLINE_STREAM_BYTES + 1)),
      'CLASSROOM_OUTLINE_INVALID',
    );
  });
});

function expectApiError(action: () => unknown, code: string) {
  try {
    action();
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
  }
}
