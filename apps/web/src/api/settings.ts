import { apiJson } from './client';
import type { ModelRef } from './chat';

export type Provider = { id: string; name: string; configured: boolean; modelCount: number; authSource?: string };
export type CustomProvider = { id: string; name: string; baseUrl: string; api: string; modelIds: unknown; enabled: boolean; configured: boolean };
export type Skill = { name: string; description: string; filePath: string; enabled: boolean; source: { id: string; label: string; trusted: boolean }; disableModelInvocation: boolean };
export type McpServer = { id: string; name: string; transport: 'stdio' | 'sse' | 'http'; command: string | null; args: unknown; url: string | null; enabled: boolean; configuredEnv: boolean };
export type Tool = { name: string; label: string; description: string; source: string; requiresApproval: boolean; enabled: boolean; approval: 'default' | 'always' | 'never' };
export type Model = { id: string; name: string; providerId: string };

export const settingsApi = {
  providers() {
    return apiJson<{ providers: Provider[]; customProviders: CustomProvider[]; defaultModel: ModelRef | null }>('/providers');
  },

  async load() {
    const [providers, skills, mcp, tools] = await Promise.all([
      settingsApi.providers(),
      apiJson<{ skills: Skill[]; diagnostics: Array<{ message: string; code: string }> }>('/skills'),
      apiJson<{ servers: McpServer[] }>('/mcp'),
      apiJson<{ tools: Tool[] }>('/tools'),
    ]);
    return { ...providers, ...skills, ...mcp, ...tools };
  },

  models(provider?: string) {
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : '';
    return apiJson<{ models: Model[] }>(`/models${query}`);
  },

  saveCredential(providerId: string, apiKey: string) {
    return apiJson(`/providers/${encodeURIComponent(providerId)}/credential`, { method: 'PUT', body: JSON.stringify({ apiKey }) });
  },

  removeCredential(providerId: string) {
    return apiJson(`/providers/${encodeURIComponent(providerId)}/credential`, { method: 'DELETE' });
  },

  saveDefaultModel(model: ModelRef) {
    return apiJson('/settings/model', { method: 'PUT', body: JSON.stringify(model) });
  },

  createCustomProvider(input: { name: string; baseUrl: string; modelIds: string[]; apiKey?: string }) {
    return apiJson<{ provider: CustomProvider }>('/providers/custom', { method: 'POST', body: JSON.stringify(input) });
  },

  deleteCustomProvider(id: string) {
    return apiJson(`/providers/custom/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  setSkillEnabled(skillName: string, enabled: boolean) {
    return apiJson('/skills', { method: 'PATCH', body: JSON.stringify({ skillName, enabled }) });
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
};
