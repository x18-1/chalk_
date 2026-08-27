import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  promptRegistry,
  snippetRegistry,
  type PromptId,
  type PromptVariables,
  type SnippetId,
} from './registry';

export type BuiltPrompt = {
  system: string;
  user?: string;
  revision: string;
};

function assetsDirectory() {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  return existsSync(join(moduleDirectory, 'templates'))
    ? moduleDirectory
    : join(moduleDirectory, 'prompts');
}

function readAsset(path: string) {
  try {
    return readFileSync(join(assetsDirectory(), path), 'utf8');
  } catch (error) {
    throw new Error(`Prompt asset is missing: ${path}`, { cause: error });
  }
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function templatePath(promptId: PromptId, part: 'system' | 'user', language: 'en' | 'zh-CN') {
  return `templates/${promptId}/${part}.${language}.md`;
}

function snippetPath(snippetId: SnippetId, language: 'en' | 'zh-CN') {
  return `snippets/${snippetId}.${language}.md`;
}

function processConditions(template: string, variables: Record<string, unknown>) {
  const rendered = template.replace(
    /\{\{#if ([A-Za-z][A-Za-z0-9_]*)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, condition: string, content: string) => variables[condition] ? content : '',
  );
  if (/\{\{#if |\{\{\/if\}\}/.test(rendered)) {
    throw new Error('Prompt contains an invalid or nested conditional block');
  }
  return rendered;
}

function processSnippets(template: string, language: 'en' | 'zh-CN', stack: readonly string[] = []): string {
  return template.replace(/\{\{snippet:([a-z][a-z0-9-]*)\}\}/g, (_match, id: string) => {
    if (!(id in snippetRegistry)) throw new Error(`Unknown prompt snippet: ${id}`);
    if (stack.includes(id)) throw new Error(`Prompt snippet cycle: ${[...stack, id].join(' -> ')}`);
    return processSnippets(
      readAsset(snippetPath(id as SnippetId, language)).trim(),
      language,
      [...stack, id],
    );
  });
}

function interpolate(template: string, variables: Record<string, unknown>) {
  const rendered = template.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (placeholder, key: string) => {
    if (!(key in variables)) throw new Error(`Prompt variable is missing: ${key}`);
    const value = variables[key];
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
  const residual = rendered.match(/\{\{[^}]+\}\}/)?.[0];
  if (residual) throw new Error(`Prompt rendering left an unresolved placeholder: ${residual}`);
  return rendered.trim();
}

function prepare(template: string, variables: Record<string, unknown>, language: 'en' | 'zh-CN') {
  return processSnippets(processConditions(template, variables), language).trim();
}

export function buildPrompt<Id extends PromptId>(
  promptId: Id,
  variables: PromptVariables[Id],
): BuiltPrompt {
  const definition = promptRegistry[promptId];
  if (!definition) throw new Error(`Unknown prompt: ${promptId}`);
  const values = variables as Record<string, unknown>;
  for (const key of definition.variables) {
    if (!(key in values)) throw new Error(`Prompt variable is missing: ${key}`);
  }
  for (const key of Object.keys(values)) {
    if (!(definition.variables as readonly string[]).includes(key)) {
      throw new Error(`Unknown prompt variable: ${key}`);
    }
  }
  const systemSource = prepare(readAsset(templatePath(promptId, 'system', 'en')), values, 'en');
  const userSource = definition.user
    ? prepare(readAsset(templatePath(promptId, 'user', 'en')), values, 'en')
    : undefined;
  const system = interpolate(systemSource, values);
  const user = userSource === undefined ? undefined : interpolate(userSource, values);
  return {
    system,
    ...(user !== undefined ? { user } : {}),
    revision: hash(`${systemSource}\0${userSource ?? ''}`),
  };
}

function references(template: string) {
  return {
    variables: [...template.matchAll(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g)].map((match) => match[1]).sort(),
    conditions: [...template.matchAll(/\{\{#if ([A-Za-z][A-Za-z0-9_]*)\}\}/g)].map((match) => match[1]).sort(),
    snippets: [...template.matchAll(/\{\{snippet:([a-z][a-z0-9-]*)\}\}/g)].map((match) => match[1]).sort(),
  };
}

function assertPaired(english: string, chinese: string, label: string) {
  const left = JSON.stringify(references(english));
  const right = JSON.stringify(references(chinese));
  if (left !== right) throw new Error(`Prompt language pair differs structurally: ${label}`);
}

export function validatePromptRegistry() {
  for (const definition of Object.values(promptRegistry)) {
    const systemEnglish = readAsset(templatePath(definition.id, 'system', 'en'));
    const systemChinese = readAsset(templatePath(definition.id, 'system', 'zh-CN'));
    assertPaired(systemEnglish, systemChinese, `${definition.id}/system`);
    if (definition.user) {
      const userEnglish = readAsset(templatePath(definition.id, 'user', 'en'));
      const userChinese = readAsset(templatePath(definition.id, 'user', 'zh-CN'));
      assertPaired(userEnglish, userChinese, `${definition.id}/user`);
    }
    if ('provenance' in definition && definition.provenance) {
      for (const [filename, expectedHash] of Object.entries(definition.provenance.files)) {
        const actualHash = hash(readAsset(`templates/${definition.id}/${filename}`));
        if (actualHash !== expectedHash) throw new Error(`Prompt provenance mismatch: ${definition.id}/${filename}`);
      }
    }
  }
  for (const [snippetId, expectedHash] of Object.entries(snippetRegistry)) {
    const english = readAsset(snippetPath(snippetId as SnippetId, 'en'));
    const chinese = readAsset(snippetPath(snippetId as SnippetId, 'zh-CN'));
    assertPaired(english, chinese, `snippet/${snippetId}`);
    if (hash(english) !== expectedHash) throw new Error(`Prompt provenance mismatch: snippet/${snippetId}`);
  }
  return {
    promptCount: Object.keys(promptRegistry).length,
    snippetCount: Object.keys(snippetRegistry).length,
  };
}
