import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../server/db';
import { SqliteRepo } from '../../server/sqliteRepo';
import type { Repo } from '../../server/repo';

const T0 = '2026-06-01T10:00:00.000Z';

function makeRepo(): Repo {
  return new SqliteRepo(openDb(':memory:'));
}

describe('SqliteRepo kids', () => {
  let repo: Repo;
  beforeEach(() => {
    repo = makeRepo();
  });

  it('creates and lists kids with defaults applied', () => {
    const kid = repo.createKid({ name: 'Ana', email: 'ana@gmail.com', weeklyAllowance: 100, createdAt: T0 });
    expect(kid.id).toBeGreaterThan(0);
    expect(kid.weeklyAllowance).toBe(100);
    expect(kid.archived).toBe(false);
    expect(repo.listKids()).toEqual([kid]);
  });

  it('finds kids by email case-insensitively', () => {
    const kid = repo.createKid({ name: 'Ana', email: 'Ana@Gmail.com', weeklyAllowance: 50, createdAt: T0 });
    expect(repo.findKidByEmail('ana@gmail.com')?.id).toBe(kid.id);
    expect(repo.findKidByEmail('ANA@GMAIL.COM')?.id).toBe(kid.id);
    expect(repo.findKidByEmail('nobody@gmail.com')).toBeUndefined();
  });

  it('updates name, email and allowance', () => {
    const kid = repo.createKid({ name: 'Ana', email: 'ana@gmail.com', weeklyAllowance: 100, createdAt: T0 });
    const updated = repo.updateKid(kid.id, { name: 'Anita', weeklyAllowance: 150 });
    expect(updated.name).toBe('Anita');
    expect(updated.weeklyAllowance).toBe(150);
    expect(updated.email).toBe('ana@gmail.com');
  });

  it('archiving hides a kid from list, get and email lookup', () => {
    const kid = repo.createKid({ name: 'Ana', email: 'ana@gmail.com', weeklyAllowance: 100, createdAt: T0 });
    repo.archiveKid(kid.id);
    expect(repo.listKids()).toEqual([]);
    expect(repo.getKid(kid.id)).toBeUndefined();
    expect(repo.findKidByEmail('ana@gmail.com')).toBeUndefined();
  });
});

describe('SqliteRepo transactions', () => {
  let repo: Repo;
  let kidId: number;
  beforeEach(() => {
    repo = makeRepo();
    kidId = repo.createKid({ name: 'Ana', email: 'ana@gmail.com', weeklyAllowance: 100, createdAt: T0 }).id;
  });

  it('adds transactions and lists newest first', () => {
    repo.addTxn({ kidId, amount: 100, note: 'Weekly reset to 100', type: 'reset', actorEmail: null, createdAt: '2026-06-01T00:00:00.000Z' });
    repo.addTxn({ kidId, amount: -5, note: 'Hit his brother', type: 'adjustment', actorEmail: 'mom@gmail.com', createdAt: '2026-06-02T00:00:00.000Z' });
    const txns = repo.listTxns(kidId);
    expect(txns.map((t) => t.note)).toEqual(['Hit his brother', 'Weekly reset to 100']);
    expect(txns[0].actorEmail).toBe('mom@gmail.com');
    expect(txns[1].type).toBe('reset');
  });

  it('balance is the signed sum of all entries and can go negative', () => {
    expect(repo.balance(kidId)).toBe(0);
    repo.addTxn({ kidId, amount: 10, note: 'reset', type: 'reset', actorEmail: null, createdAt: T0 });
    repo.addTxn({ kidId, amount: -25, note: 'broke a window', type: 'adjustment', actorEmail: 'dad@gmail.com', createdAt: T0 });
    expect(repo.balance(kidId)).toBe(-15);
  });

  it('lastResetAt returns the newest reset timestamp, ignoring adjustments', () => {
    expect(repo.lastResetAt(kidId)).toBeUndefined();
    repo.addTxn({ kidId, amount: 100, note: 'r1', type: 'reset', actorEmail: null, createdAt: '2026-06-01T00:00:00.000Z' });
    repo.addTxn({ kidId, amount: 0, note: 'r2', type: 'reset', actorEmail: null, createdAt: '2026-06-08T00:00:00.000Z' });
    repo.addTxn({ kidId, amount: 5, note: 'chores', type: 'adjustment', actorEmail: 'mom@gmail.com', createdAt: '2026-06-09T00:00:00.000Z' });
    expect(repo.lastResetAt(kidId)).toBe('2026-06-08T00:00:00.000Z');
  });
});
