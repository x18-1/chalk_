import { apiJson } from './client';

export type AuthUser = { id: string; email?: string; name?: string | null; image?: string | null; role: 'admin' | 'user' };

export const authApi = {
  login(email: string, password: string) {
    return apiJson<{ user: AuthUser }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  session(signal?: AbortSignal) {
    return apiJson<{ user: AuthUser | null }>('/auth/session', { signal });
  },

  logout() {
    return apiJson<{ ok: true }>('/auth/logout', { method: 'POST' });
  },
};
