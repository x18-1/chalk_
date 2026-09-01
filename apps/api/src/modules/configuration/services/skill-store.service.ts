import { createHash } from 'node:crypto';
import type { Database } from '../../../db/client';
import { createUserSkillsDal } from '../../../db/dal';
import { closeUserRuntimes, loadBuiltinSkillCatalog } from '../../../agent/runtime-manager';
import { ApiError } from '../../../http/errors';
import type { UserSkillCreateInput, UserSkillUpdateInput } from '../schemas';

function hash(content: string, references: Record<string, string>) {
  return createHash('sha256').update(JSON.stringify({
    content,
    references: Object.fromEntries(Object.entries(references).sort(([left], [right]) => left.localeCompare(right))),
  })).digest('hex');
}
type UserSkillRow = Awaited<ReturnType<ReturnType<typeof createUserSkillsDal>['list']>>[number];
function publicSkill(row: UserSkillRow) {
  return { id: row.id, name: row.name, description: row.description, version: row.version, contentHash: row.contentHash, enabled: row.enabled, references: Object.keys((row.references as Record<string, string> | null) ?? {}), createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export class SkillStoreService {
  private readonly skills;
  constructor(private readonly db: Database) { this.skills = createUserSkillsDal(db); }
  private async assertNameDoesNotConflictWithBuiltin(name: string) {
    const { snapshot } = await loadBuiltinSkillCatalog();
    if (snapshot.skills.some((skill) => skill.name === name)) {
      throw new ApiError(409, 'Skill name conflicts with a builtin skill', 'SKILL_NAME_CONFLICT');
    }
  }
  async list(userId: string) { return { skills: (await this.skills.list(userId)).map(publicSkill) }; }
  async get(userId: string, id: string) {
    const row = await this.skills.get(userId, id);
    return { skill: { ...publicSkill(row), content: row.content, references: row.references ?? {} } };
  }
  async create(userId: string, input: UserSkillCreateInput) {
    await this.assertNameDoesNotConflictWithBuiltin(input.name);
    const references = input.references ?? {};
    const row = await this.skills.create(userId, { ...input, references, contentHash: hash(input.content, references) });
    await closeUserRuntimes(userId);
    return publicSkill(row);
  }
  async update(userId: string, id: string, input: UserSkillUpdateInput) {
    const existing = await this.skills.get(userId, id);
    const name = input.name ?? existing.name;
    await this.assertNameDoesNotConflictWithBuiltin(name);
    const content = input.content ?? existing.content;
    const references = input.references ?? ((existing.references as Record<string, string> | null) ?? {});
    const row = await this.skills.update(userId, id, { ...input, name, content, references, contentHash: hash(content, references) });
    await closeUserRuntimes(userId);
    return publicSkill(row);
  }
  async delete(userId: string, id: string) { await this.skills.delete(userId, id); await closeUserRuntimes(userId); }
}
