import { apiJson } from './client';
import type { ModelSelection, ThinkingLevel } from './chat';

export type Provider = {
  id: string;
  name: string;
  configured: boolean;
  canRemoveCredential: boolean;
  modelCount: number;
  custom: boolean;
  baseUrl?: string;
  api?: 'openai-completions';
  models?: CustomModel[];
  enabled?: boolean;
};
export type CustomModel = {
  id: string;
  name: string;
  reasoning: boolean;
  input: Array<'text' | 'image'>;
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
};
export type Skill = { name: string; description: string; enabled: boolean; source: { id: string; label: string; trusted: boolean; scope?: 'builtin' | 'user' }; disableModelInvocation: boolean; userSkillId?: string; version?: string; contentHash?: string; references?: string[] };
export type SkillDetails = Skill & { content: string; references: Record<string, string> };
export type UserSkill = { id: string; name: string; description: string; version: string; contentHash: string; enabled: boolean; references: string[] };
export type McpServer = { id: string; name: string; transport: 'http'; url: string; enabled: boolean; configuredBearer: boolean };
export type Tool = {
  name: string;
  label: string;
  description: string;
  source: string;
  effects: string[];
  approvalPolicy: 'none' | 'required' | 'conditional';
  limits: { timeoutMs: number; maxResultCharacters: number; maxUpdateCharacters: number };
  executionMode: 'sequential' | 'parallel';
  defaultEnabled: boolean;
  requiresApproval: boolean;
  enabled: boolean;
  approval: 'default' | 'always' | 'never';
};
export type Model = {
  id: string;
  name: string;
  providerId: string;
  reasoning: boolean;
  thinkingLevels: ThinkingLevel[];
  input: string[];
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

export type MediaCapabilitySelection = {
  providerId: string;
  modelId: string | null;
};

export type VideoCapabilitySelection = MediaCapabilitySelection & {
  durationSeconds: number;
  resolution: '720p' | '1080p';
};

export type BrowserSpeechSettings = {
  adapter: 'browser';
  language: string;
  voiceUri: string | null;
  rate: number;
  volume: number;
};

export type CapabilitySettings = {
  image: MediaCapabilitySelection | null;
  video: VideoCapabilitySelection | null;
  speech: BrowserSpeechSettings;
};

export type CapabilitySettingsInput = Partial<{
  image: MediaCapabilitySelection | null;
  video: VideoCapabilitySelection | null;
  speech: BrowserSpeechSettings;
}>;

export const settingsApi = {
  providers() {
    return apiJson<{ providers: Provider[]; defaultModel: ModelSelection | null }>('/providers');
  },

  memory() {
    return apiJson<{ memoryInjectionEnabled: boolean }>('/settings');
  },

  setMemoryEnabled(enabled: boolean) {
    return apiJson<{ memoryInjectionEnabled: boolean }>('/settings/memory', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
    });
  },

  async load() {
    const [providers, settings, skills, mcp, tools] = await Promise.all([
      settingsApi.providers(),
      settingsApi.memory(),
      apiJson<{ skills: Skill[]; diagnostics: Array<{ message: string; code: string }> }>('/skills'),
      apiJson<{ servers: McpServer[] }>('/mcp'),
      apiJson<{ tools: Tool[] }>('/tools'),
    ]);
    return { ...providers, ...settings, ...skills, ...mcp, ...tools };
  },

  capabilities() {
    return apiJson<CapabilitySettings>('/settings/capabilities');
  },

  saveCapabilities(input: CapabilitySettingsInput) {
    return apiJson<CapabilitySettings>('/settings/capabilities', { method: 'PUT', body: JSON.stringify(input) });
  },

  models(provider?: string) {
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : '';
    return apiJson<{ models: Model[] }>(`/models${query}`);
  },

  saveCredential(providerId: string, apiKey: string) {
    return apiJson<{ providerId: string; configured: boolean }>(`/providers/${encodeURIComponent(providerId)}/credential`, { method: 'PUT', body: JSON.stringify({ apiKey }) });
  },

  removeCredential(providerId: string) {
    return apiJson<{ providerId: string; configured: boolean; canRemoveCredential: false }>(`/providers/${encodeURIComponent(providerId)}/credential`, { method: 'DELETE' });
  },

  testProvider(providerId: string, modelId: string) {
    return apiJson<{ ok: boolean; providerId: string; modelId: string; durationMs?: number; error?: string }>(`/providers/${encodeURIComponent(providerId)}/test`, { method: 'POST', body: JSON.stringify({ modelId }) });
  },

  saveDefaultModel(model: ModelSelection) {
    return apiJson('/settings/model', { method: 'PUT', body: JSON.stringify(model) });
  },

  createCustomProvider(input: { name: string; baseUrl: string; models: CustomModel[]; apiKey?: string }) {
    return apiJson<{ provider: Provider }>('/providers/custom', { method: 'POST', body: JSON.stringify(input) });
  },

  updateCustomProvider(id: string, input: { name: string; baseUrl: string; models: CustomModel[]; apiKey?: string }) {
    return apiJson<{ provider: Provider }>(`/providers/custom/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
  },

  deleteCustomProvider(id: string) {
    return apiJson(`/providers/custom/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  setSkillEnabled(skillName: string, enabled: boolean) {
    return apiJson('/skills', { method: 'PATCH', body: JSON.stringify({ skillName, enabled }) });
  },

  getSkill(name: string) {
    return apiJson<{ skill: SkillDetails }>(`/skills/${encodeURIComponent(name)}`);
  },

  saveMcp(input: Record<string, unknown>, id?: string) {
    return apiJson<{ server: McpServer }>(id ? `/mcp/${encodeURIComponent(id)}` : '/mcp', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(input) });
  },

  toggleMcp(id: string, enabled: boolean) {
    return apiJson<{ server: McpServer }>(`/mcp/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ enabled }) });
  },

  testMcp(id: string) {
    return apiJson<{ status: { state: string; toolCount: number } }>(`/mcp/${encodeURIComponent(id)}/test`, { method: 'POST' });
  },

  deleteMcp(id: string) {
    return apiJson(`/mcp/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  updateTool(toolName: string, input: { enabled: boolean; approval: Tool['approval'] }) {
    return apiJson('/tools', { method: 'PATCH', body: JSON.stringify({ toolName, ...input }) });
  },

  createUserSkill(input: { name: string; description: string; content: string; references?: Record<string, string>; version?: string; enabled?: boolean }) {
    return apiJson<{ skill: UserSkill }>('/user-skills', { method: 'POST', body: JSON.stringify(input) });
  },

  getUserSkill(id: string) {
    return apiJson<{ skill: UserSkill & { content: string; references: Record<string, string> } }>(`/user-skills/${encodeURIComponent(id)}`);
  },

  updateUserSkill(id: string, input: Partial<{ name: string; description: string; content: string; references: Record<string, string>; version: string; enabled: boolean }>) {
    return apiJson<{ skill: UserSkill }>(`/user-skills/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input) });
  },

  deleteUserSkill(id: string) {
    return apiJson(`/user-skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};
