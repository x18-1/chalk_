import { describe, expect, it } from 'vitest';
import { openMaicStageFixture } from '../fixtures/openmaic-stage.js';
import { SceneContentSchema, StageSchema, parseStageDocument } from '../../src/schema.js';

describe('OpenMAIC Stage schema', () => {
  it('parses the fixed Stage -> Scene -> Action fixture', () => {
    const parsed = parseStageDocument(openMaicStageFixture);

    expect(parsed.stage.id).toBe('stage-equation-properties-v1');
    expect(parsed.scenes.map((scene) => scene.type)).toEqual([
      'slide',
      'interactive',
      'quiz',
      'pbl',
    ]);
    expect(parsed.scenes[0]?.actions?.[0]).toMatchObject({ type: 'speech' });
  });

  it('reports an invalid Scene and nested Action instead of accepting partial data', () => {
    const invalid = structuredClone(openMaicStageFixture);
    invalid.scenes[0]!.type = 'slide';
    invalid.scenes[0]!.content = { type: 'quiz', questions: [] };
    invalid.scenes[0]!.actions = [{ id: 'bad-action', type: 'speech' }];

    const result = StageSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (result.success) return;

    const paths = result.error.issues.map((issue) => issue.path.join('/'));
    expect(paths).toContain('scenes/0/content/type');
    expect(paths).toContain('scenes/0/actions/0/text');
  });

  it('rejects an unknown action type and a scene with a mismatched parent stage', () => {
    const invalid = structuredClone(openMaicStageFixture);
    invalid.scenes[0]!.stageId = 'other-stage';
    invalid.scenes[0]!.actions = [{ id: 'bad-action', type: 'teleport_teacher' }];

    const result = StageSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (result.success) return;

    const paths = result.error.issues.map((issue) => issue.path.join('/'));
    expect(paths).toContain('scenes/0/stageId');
    expect(paths).toContain('scenes/0/actions/0/type');
  });

  it('accepts self-contained interactive HTML through the canonical Scene content contract', () => {
    expect(SceneContentSchema.parse({
      type: 'interactive',
      html: '<canvas id="lesson"></canvas>',
    })).toMatchObject({ type: 'interactive' });

    expect(SceneContentSchema.safeParse({ type: 'interactive' }).success).toBe(false);
    expect(SceneContentSchema.safeParse({ type: 'quiz', questions: 'not-an-array' }).success).toBe(false);
  });
});
