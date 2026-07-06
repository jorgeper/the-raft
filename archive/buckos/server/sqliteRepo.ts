import type Database from 'better-sqlite3';
import type { Kid, Txn } from './types';
import type { Repo } from './repo';

interface KidRow {
  id: number;
  name: string;
  email: string;
  weekly_allowance: number;
  archived: number;
  created_at: string;
  avatar: string | null;
}

interface TxnRow {
  id: number;
  kid_id: number;
  amount: number;
  note: string;
  type: 'adjustment' | 'reset';
  actor_email: string | null;
  created_at: string;
}

function toKid(row: KidRow): Kid {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    weeklyAllowance: row.weekly_allowance,
    archived: row.archived === 1,
    createdAt: row.created_at,
    avatar: row.avatar,
  };
}

function toTxn(row: TxnRow): Txn {
  return {
    id: row.id,
    kidId: row.kid_id,
    amount: row.amount,
    note: row.note,
    type: row.type,
    actorEmail: row.actor_email,
    createdAt: row.created_at,
  };
}

export class SqliteRepo implements Repo {
  constructor(private db: Database.Database) {}

  listKids(): Kid[] {
    const rows = this.db
      .prepare('SELECT * FROM kids WHERE archived = 0 ORDER BY created_at, id')
      .all() as KidRow[];
    return rows.map(toKid);
  }

  getKid(id: number): Kid | undefined {
    const row = this.db.prepare('SELECT * FROM kids WHERE id = ? AND archived = 0').get(id) as
      | KidRow
      | undefined;
    return row ? toKid(row) : undefined;
  }

  findKidByEmail(email: string): Kid | undefined {
    const row = this.db
      .prepare('SELECT * FROM kids WHERE lower(email) = lower(?) AND archived = 0')
      .get(email) as KidRow | undefined;
    return row ? toKid(row) : undefined;
  }

  createKid(k: { name: string; email: string; weeklyAllowance: number; createdAt: string; avatar?: string | null }): Kid {
    const result = this.db
      .prepare('INSERT INTO kids (name, email, weekly_allowance, created_at, avatar) VALUES (?, ?, ?, ?, ?)')
      .run(k.name, k.email, k.weeklyAllowance, k.createdAt, k.avatar ?? null);
    return this.mustGetAnyKid(Number(result.lastInsertRowid));
  }

  updateKid(id: number, patch: Partial<Pick<Kid, 'name' | 'email' | 'weeklyAllowance' | 'avatar'>>): Kid {
    const current = this.getKid(id);
    if (!current) throw new Error(`kid ${id} not found`);
    this.db
      .prepare('UPDATE kids SET name = ?, email = ?, weekly_allowance = ?, avatar = ? WHERE id = ?')
      .run(
        patch.name ?? current.name,
        patch.email ?? current.email,
        patch.weeklyAllowance ?? current.weeklyAllowance,
        patch.avatar === undefined ? current.avatar : patch.avatar,
        id
      );
    return this.mustGetAnyKid(id);
  }

  archiveKid(id: number): void {
    this.db.prepare('UPDATE kids SET archived = 1 WHERE id = ?').run(id);
  }

  listTxns(kidId: number): Txn[] {
    const rows = this.db
      .prepare('SELECT * FROM transactions WHERE kid_id = ? ORDER BY created_at DESC, id DESC')
      .all(kidId) as TxnRow[];
    return rows.map(toTxn);
  }

  addTxn(t: Omit<Txn, 'id'>): Txn {
    const result = this.db
      .prepare(
        'INSERT INTO transactions (kid_id, amount, note, type, actor_email, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(t.kidId, t.amount, t.note, t.type, t.actorEmail, t.createdAt);
    const row = this.db
      .prepare('SELECT * FROM transactions WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as TxnRow;
    return toTxn(row);
  }

  getTxn(id: number): Txn | undefined {
    const row = this.db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as TxnRow | undefined;
    return row ? toTxn(row) : undefined;
  }

  deleteTxn(id: number): void {
    this.db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  }

  setTxnAmount(id: number, amount: number): void {
    this.db.prepare('UPDATE transactions SET amount = ? WHERE id = ?').run(amount, id);
  }

  balance(kidId: number): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE kid_id = ?')
      .get(kidId) as { total: number };
    return row.total;
  }

  lastResetAt(kidId: number): string | undefined {
    const row = this.db
      .prepare(
        "SELECT created_at FROM transactions WHERE kid_id = ? AND type = 'reset' ORDER BY created_at DESC, id DESC LIMIT 1"
      )
      .get(kidId) as { created_at: string } | undefined;
    return row?.created_at;
  }

  getSetting(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  private mustGetAnyKid(id: number): Kid {
    const row = this.db.prepare('SELECT * FROM kids WHERE id = ?').get(id) as KidRow;
    return toKid(row);
  }
}
