export type Role = 'parent' | 'kid';

export interface Kid {
  id: number;
  name: string;
  email: string;
  weeklyAllowance: number;
  archived: boolean;
  createdAt: string; // ISO 8601
}

export interface Txn {
  id: number;
  kidId: number;
  amount: number; // signed delta
  note: string;
  type: 'adjustment' | 'reset';
  actorEmail: string | null; // null for system (reset) entries
  createdAt: string; // ISO 8601
}

export interface SessionUser {
  email: string;
  role: Role;
  kidId?: number;
  name?: string;
}
