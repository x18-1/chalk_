import { describe, expect, it } from 'vitest';

import {
  userSkillCreateSchema,
  userSkillUpdateSchema,
} from '../../src/modules/configuration/schemas';

function userSkill(references: Record<string, string>) {
  return {
    name: 'test-skill',
    description: 'A deterministic user Skill fixture',
    content: 'Use this fixture for schema tests.',
    references,
  };
}

describe('user Skill configuration schema', () => {
  it('accepts bounded references nested within references/', () => {
    expect(userSkillCreateSchema.parse(userSkill({
      'references/examples/lesson-1.md': 'Example',
    })).references).toEqual({
      'references/examples/lesson-1.md': 'Example',
    });
  });

  it('does not synthesize references during a partial update', () => {
    expect(userSkillUpdateSchema.parse({ description: 'Updated description' }))
      .toEqual({ description: 'Updated description' });
  });

  it.each([
    '../SKILL.md',
    'references/../SKILL.md',
    'references/examples/../../SKILL.md',
    'references//guide.md',
    'rules/guide.md',
  ])('rejects an unsafe reference path: %s', (path) => {
    expect(() => userSkillCreateSchema.parse(userSkill({ [path]: 'Unsafe' })))
      .toThrow();
  });

  it('rejects more than 32 references', () => {
    const references = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`references/${index}.md`, 'Fixture']),
    );

    expect(() => userSkillCreateSchema.parse(userSkill(references)))
      .toThrow(/at most 32 references/);
  });

  it('rejects references larger than the aggregate byte limit', () => {
    const references = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [
        `references/${index}.md`,
        'x'.repeat(64 * 1024),
      ]),
    );

    expect(() => userSkillCreateSchema.parse(userSkill(references)))
      .toThrow(/at most 524288 bytes/);
  });
});
