import { describe, expect, it } from 'vitest';

import type { SkillSummary } from '@chalk/agent-runtime';

import { resolveEnabledSkillNames } from '../../src/agent/skill-enablement';

function skill(name: string, scope: 'builtin' | 'user'): SkillSummary {
  return {
    name,
    description: `${scope} fixture`,
    source: {
      id: `${scope}-${name}`,
      label: `${scope} skills`,
      trusted: scope === 'builtin',
      scope,
    },
    disableModelInvocation: false,
  };
}

describe('Skill enablement', () => {
  it('uses skill_settings only for builtin Skills', () => {
    const enabled = resolveEnabledSkillNames(
      [skill('builtin-skill', 'builtin'), skill('user-skill', 'user')],
      [
        { skillName: 'builtin-skill', enabled: false },
        { skillName: 'user-skill', enabled: false },
      ],
      [{ name: 'user-skill', enabled: true }],
    );

    expect(enabled).toEqual(new Set(['user-skill']));
  });

  it('uses user_skills.enabled only for user Skills', () => {
    const enabled = resolveEnabledSkillNames(
      [skill('builtin-skill', 'builtin'), skill('user-skill', 'user')],
      [{ skillName: 'user-skill', enabled: true }],
      [{ name: 'user-skill', enabled: false }],
    );

    expect(enabled).toEqual(new Set(['builtin-skill']));
  });
});
