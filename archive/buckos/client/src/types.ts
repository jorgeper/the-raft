export type Role = 'parent' | 'kid';

export interface SessionUser {
  email: string;
  role: Role;
  kidId?: number;
  name?: string;
  avatar?: string | null;
}

export interface ChartPoint {
  date: string; // YYYY-MM-DD
  balance: number;
  isToday: boolean;
}

export interface Txn {
  id: number;
  kidId: number;
  amount: number;
  note: string;
  type: 'adjustment' | 'reset';
  actorEmail: string | null;
  createdAt: string;
}

export interface Kid {
  id: number;
  name: string;
  email: string;
  weeklyAllowance: number;
  createdAt: string;
  avatar: string | null;
}

export interface KidWithDerived extends Kid {
  balance: number;
  chart: ChartPoint[];
}

export interface KidDetail {
  kid: Kid;
  balance: number;
  chart: ChartPoint[];
  transactions: Txn[];
}

export interface KidSummary {
  kid: { id: number; name: string; weeklyAllowance: number };
  balance: number;
  chart: ChartPoint[];
  transactions: Txn[];
}

export interface DevUser {
  email: string;
  role: Role;
  name: string;
  avatar: string | null;
}
