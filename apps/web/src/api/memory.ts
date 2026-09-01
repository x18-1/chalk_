import { apiJson } from './client';

export type MemoryEntry = {
  id: string; layer: 'L2' | 'L3'; surface: string | null; slot: string | null;
  section: string; text: string; refs: string[]; status: 'active' | 'archived'; version: number;
  createdAt: string; updatedAt: string;
};
export type MemoryConsolidationRun = { id: string; status: 'queued' | 'running' | 'completed' | 'failed'; requestedAt: string; startedAt: string | null; finishedAt: string | null; error: string | null };

export const memoryApi = {
  async context() { return apiJson<{ memory: { text: string; entries: MemoryEntry[] } }>('/memory/context'); },
  async list(options: { layer?: 'L2' | 'L3'; includeArchived?: boolean } = {}) {
    const params = new URLSearchParams(); if (options.layer) params.set('layer', options.layer); if (options.includeArchived) params.set('includeArchived', 'true');
    return apiJson<{ entries: MemoryEntry[] }>(`/memory${params.toString() ? `?${params}` : ''}`);
  },
  async update(id: string, input: { text?: string; section?: string; status?: 'active' | 'archived' }) {
    return apiJson<{ entry: MemoryEntry }>(`/memory/entries/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
  },
  async runs() { return apiJson<{ runs: MemoryConsolidationRun[] }>('/memory/consolidation/runs'); },
  async consolidate() { return apiJson<{ run: { processed: number; promoted: number; added: number; edited: number; deleted: number } }>('/memory/consolidation', { method: 'POST', body: JSON.stringify({}) }); },
};
