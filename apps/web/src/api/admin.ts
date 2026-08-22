import { apiJson } from './client';

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  role: 'admin' | 'user';
  createdAt: string;
};

export const adminApi = {
  listUsers(params: { query?: string; role?: AdminUser['role']; limit?: number; offset?: number } = {}, signal?: AbortSignal) {
    const search = new URLSearchParams();
    if (params.query) search.set('q', params.query);
    if (params.role) search.set('role', params.role);
    if (params.limit !== undefined) search.set('limit', String(params.limit));
    if (params.offset !== undefined) search.set('offset', String(params.offset));
    const suffix = search.toString();
    return apiJson<{ users: AdminUser[]; total: number; limit: number; offset: number }>(
      `/admin/users${suffix ? `?${suffix}` : ''}`,
      { signal },
    );
  },
};
