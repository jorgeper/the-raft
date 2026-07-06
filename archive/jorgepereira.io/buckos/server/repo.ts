import type { Kid, Txn } from './types';

/**
 * Storage abstraction. All business logic goes through this interface so the
 * backing store (SQLite today) can be swapped for Postgres/Supabase later
 * without touching domain code.
 */
export interface Repo {
  listKids(): Kid[]; // non-archived only
  getKid(id: number): Kid | undefined; // non-archived only
  findKidByEmail(email: string): Kid | undefined; // non-archived, case-insensitive
  createKid(k: { name: string; email: string; weeklyAllowance: number; createdAt: string; avatar?: string | null }): Kid;
  updateKid(id: number, patch: Partial<Pick<Kid, 'name' | 'email' | 'weeklyAllowance' | 'avatar' | 'googlePicture'>>): Kid;
  archiveKid(id: number): void;

  listTxns(kidId: number): Txn[]; // newest first
  addTxn(t: Omit<Txn, 'id'>): Txn;
  getTxn(id: number): Txn | undefined;
  deleteTxn(id: number): void;
  setTxnAmount(id: number, amount: number): void;
  balance(kidId: number): number; // SUM(amount) over the kid's ledger
  lastResetAt(kidId: number): string | undefined; // created_at of most recent reset entry

  getSetting(key: string): string | undefined;
  setSetting(key: string, value: string): void;
}
