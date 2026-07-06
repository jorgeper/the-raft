import type { DevUser, KidDetail, KidSummary, KidWithDerived, SessionUser, Txn } from './types';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string
  ) {
    super(`${status} ${code}`);
  }
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  if (!res.ok) {
    let code = 'request-failed';
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const getMe = () => api<{ user: SessionUser | null }>('/api/me');
export const getAuthMode = () => api<{ mode: 'dev' | 'google' }>('/api/auth/mode');
export const getDevUsers = () => api<{ users: DevUser[] }>('/api/auth/dev-users');
export const devLogin = (email: string) =>
  api<{ user: SessionUser }>('/api/auth/dev-login', { method: 'POST', body: JSON.stringify({ email }) });
export const logout = () => api<void>('/api/auth/logout', { method: 'POST' });

export const listKids = () => api<{ kids: KidWithDerived[] }>('/api/kids');
export const createKid = (body: { name: string; email: string; weeklyAllowance: number; avatar?: string | null }) =>
  api<{ kid: KidWithDerived }>('/api/kids', { method: 'POST', body: JSON.stringify(body) });
export const updateKid = (
  id: number,
  body: { name?: string; email?: string; weeklyAllowance?: number; avatar?: string | null }
) => api<{ kid: KidWithDerived }>(`/api/kids/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
export const deleteTransaction = (kidId: number, txnId: number) =>
  api<{ balance: number }>(`/api/kids/${kidId}/transactions/${txnId}`, { method: 'DELETE' });
export const removeKid = (id: number) => api<void>(`/api/kids/${id}`, { method: 'DELETE' });
export const getKidDetail = (id: number) => api<KidDetail>(`/api/kids/${id}`);
export const addTransaction = (kidId: number, body: { amount: number; note: string; direction: 'add' | 'withdraw' }) =>
  api<{ transaction: Txn; balance: number }>(`/api/kids/${kidId}/transactions`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
export const getKidSummary = () => api<KidSummary>('/api/kid/summary');
export const updateKidAvatar = (avatar: string | null) =>
  api<{ avatar: string | null }>('/api/kid/profile', { method: 'PATCH', body: JSON.stringify({ avatar }) });

export const getSettings = () => api<{ weeklyAllowance: number }>('/api/settings');
export const updateSettings = (body: { weeklyAllowance: number }) =>
  api<{ weeklyAllowance: number }>('/api/settings', { method: 'PATCH', body: JSON.stringify(body) });

export interface Profile {
  name: string | null;
  avatar: string | null;
}
export const getProfile = () => api<Profile>('/api/profile');
export const updateProfile = (body: { name?: string; avatar?: string | null }) =>
  api<Profile>('/api/profile', { method: 'PATCH', body: JSON.stringify(body) });
