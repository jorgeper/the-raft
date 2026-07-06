import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../server/db';
import { SqliteRepo } from '../../server/sqliteRepo';
import type { Repo } from '../../server/repo';
import type { Kid } from '../../server/types';
import { FixedClock } from '../../server/clock';
import { resetBoundariesSince, ensureResets, chartData } from '../../server/ledger';
import { loadConfig, type Config } from '../../server/config';

// Local-time helpers: months are 0-based in the Date constructor.
// 2026-06-01 is a Monday.
const monday = (h = 0) => new Date(2026, 5, 1, h); // Mon Jun 1 2026, local
const local = (d: number, h = 0, min = 0) => new Date(2026, 5, d, h, min);

function makeConfig(overrides: Partial<Config> = {}): Config {
  const cfg = loadConfig({
    AUTH_MODE: 'dev',
    PARENT_EMAILS: 'mom@gmail.com',
    SESSION_SECRET: 'test',
    DATABASE_PATH: ':memory:',
  } as NodeJS.ProcessEnv);
  return { ...cfg, ...overrides };
}

describe('resetBoundariesSince', () => {
  const DAY = 1; // Monday
  const HOUR = 0;

  it('returns nothing within the same week', () => {
    expect(resetBoundariesSince(local(2, 10), local(5, 10), DAY, HOUR)).toEqual([]);
  });

  it('returns one boundary when a single Monday 00:00 was crossed', () => {
    const bounds = resetBoundariesSince(local(5, 10), local(9, 10), DAY, HOUR);
    expect(bounds).toEqual([local(8, 0)]); // Mon Jun 8 2026 00:00
  });

  it('returns one boundary per missed week', () => {
    const bounds = resetBoundariesSince(local(2, 0), new Date(2026, 6, 1), DAY, HOUR); // Jul 1
    expect(bounds).toEqual([local(8), local(15), local(22), local(29)]);
  });

  it('does not duplicate a boundary exactly equal to from', () => {
    expect(resetBoundariesSince(monday(0), local(3, 10), DAY, HOUR)).toEqual([]);
  });

  it('includes a boundary exactly equal to now', () => {
    expect(resetBoundariesSince(local(5), local(8, 0), DAY, HOUR)).toEqual([local(8, 0)]);
  });

  it('respects a configurable reset day and hour', () => {
    // Reset on Wednesdays (3) at 06:00
    const bounds = resetBoundariesSince(local(1, 0), local(11, 0), 3, 6);
    expect(bounds).toEqual([local(3, 6), local(10, 6)]);
  });
});

describe('ensureResets', () => {
  let repo: Repo;
  let clock: FixedClock;
  let cfg: Config;

  beforeEach(() => {
    repo = new SqliteRepo(openDb(':memory:'));
    clock = new FixedClock();
    cfg = makeConfig();
  });

  function makeKid(createdAt: Date, allowance = 100): Kid {
    const kid = repo.createKid({
      name: 'Ana',
      email: 'ana@gmail.com',
      weeklyAllowance: allowance,
      createdAt: createdAt.toISOString(),
    });
    // Kid creation writes the initial reset row (same as the route does).
    repo.addTxn({
      kidId: kid.id,
      amount: allowance,
      note: `Weekly reset to ${allowance}`,
      type: 'reset',
      actorEmail: null,
      createdAt: createdAt.toISOString(),
    });
    return kid;
  }

  it('does nothing mid-week', () => {
    const kid = makeKid(local(2, 10)); // Tue
    clock.set(local(5, 10)); // Fri same week
    ensureResets(repo, kid, clock, cfg);
    expect(repo.listTxns(kid.id)).toHaveLength(1);
    expect(repo.balance(kid.id)).toBe(100);
  });

  it('inserts a reset stamped at the boundary that lands balance on the allowance', () => {
    const kid = makeKid(local(2, 10)); // Tue, balance 100
    repo.addTxn({ kidId: kid.id, amount: -30, note: 'Hit his brother', type: 'adjustment', actorEmail: 'mom@gmail.com', createdAt: local(4, 12).toISOString() });
    clock.set(local(9, 9)); // Tue next week
    ensureResets(repo, kid, clock, cfg);

    const txns = repo.listTxns(kid.id);
    expect(txns).toHaveLength(3);
    const reset = txns[0];
    expect(reset.type).toBe('reset');
    expect(reset.note).toBe('Weekly reset to 100');
    expect(reset.amount).toBe(30); // 70 -> 100
    expect(new Date(reset.createdAt).getTime()).toBe(local(8, 0).getTime());
    expect(repo.balance(kid.id)).toBe(100);
  });

  it('catches up multiple missed weeks with one reset row each', () => {
    const kid = makeKid(local(2, 10)); // Tue Jun 2
    repo.addTxn({ kidId: kid.id, amount: 20, note: 'chores', type: 'adjustment', actorEmail: 'mom@gmail.com', createdAt: local(3).toISOString() });
    clock.set(new Date(2026, 5, 24, 12)); // Wed Jun 24 — missed Jun 8, 15, 22
    ensureResets(repo, kid, clock, cfg);

    const resets = repo.listTxns(kid.id).filter((t) => t.type === 'reset' && t.createdAt !== local(2, 10).toISOString());
    expect(resets).toHaveLength(3);
    const stamps = resets.map((t) => new Date(t.createdAt).getTime()).sort((a, b) => a - b);
    expect(stamps).toEqual([local(8).getTime(), local(15).getTime(), local(22).getTime()]);
    // First catch-up delta: 120 -> 100 = -20; later weeks: already 100, delta 0.
    const byStamp = resets.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    expect(byStamp.map((t) => t.amount)).toEqual([-20, 0, 0]);
    expect(repo.balance(kid.id)).toBe(100);
  });

  it('is idempotent when called twice', () => {
    const kid = makeKid(local(2, 10));
    clock.set(local(9, 9));
    ensureResets(repo, kid, clock, cfg);
    ensureResets(repo, kid, clock, cfg);
    expect(repo.listTxns(kid.id).filter((t) => t.type === 'reset')).toHaveLength(2);
  });

  it('uses the kid allowance at reset time', () => {
    const kid = makeKid(local(2, 10), 50);
    clock.set(local(9, 9));
    ensureResets(repo, kid, clock, cfg);
    expect(repo.balance(kid.id)).toBe(50);
    expect(repo.listTxns(kid.id)[0].note).toBe('Weekly reset to 50');
  });
});

describe('chartData', () => {
  let repo: Repo;
  let clock: FixedClock;

  beforeEach(() => {
    repo = new SqliteRepo(openDb(':memory:'));
    clock = new FixedClock();
  });

  it('returns 7 end-of-day balances ending today, today flagged', () => {
    const kid = repo.createKid({ name: 'Ana', email: 'a@g.com', weeklyAllowance: 100, createdAt: local(1).toISOString() });
    repo.addTxn({ kidId: kid.id, amount: 100, note: 'Weekly reset to 100', type: 'reset', actorEmail: null, createdAt: local(1).toISOString() });
    repo.addTxn({ kidId: kid.id, amount: -20, note: 'window', type: 'adjustment', actorEmail: 'mom@g.com', createdAt: local(3, 15).toISOString() });
    repo.addTxn({ kidId: kid.id, amount: 5, note: 'dishes', type: 'adjustment', actorEmail: 'mom@g.com', createdAt: local(6, 18).toISOString() });

    clock.set(local(7, 12)); // Sun Jun 7, midday
    const data = chartData(repo, kid.id, clock);

    expect(data).toHaveLength(7);
    expect(data.map((d) => d.balance)).toEqual([100, 100, 80, 80, 80, 85, 85]);
    expect(data[6].isToday).toBe(true);
    expect(data.slice(0, 6).every((d) => !d.isToday)).toBe(true);
    expect(data[0].date).toBe('2026-06-01');
    expect(data[6].date).toBe('2026-06-07');
  });

  it('shows zero for days before the kid had any ledger entries', () => {
    const kid = repo.createKid({ name: 'Ana', email: 'a@g.com', weeklyAllowance: 100, createdAt: local(5).toISOString() });
    repo.addTxn({ kidId: kid.id, amount: 100, note: 'Weekly reset to 100', type: 'reset', actorEmail: null, createdAt: local(5).toISOString() });
    clock.set(local(7, 12));
    const data = chartData(repo, kid.id, clock);
    expect(data.map((d) => d.balance)).toEqual([0, 0, 0, 0, 100, 100, 100]);
  });

  it('reflects a mid-window weekly reset in end-of-day balances', () => {
    const kid = repo.createKid({ name: 'Ana', email: 'a@g.com', weeklyAllowance: 100, createdAt: local(2).toISOString() });
    repo.addTxn({ kidId: kid.id, amount: 100, note: 'Weekly reset to 100', type: 'reset', actorEmail: null, createdAt: local(2).toISOString() });
    repo.addTxn({ kidId: kid.id, amount: -80, note: 'broke tv', type: 'adjustment', actorEmail: 'mom@g.com', createdAt: local(4).toISOString() });
    repo.addTxn({ kidId: kid.id, amount: 80, note: 'Weekly reset to 100', type: 'reset', actorEmail: null, createdAt: local(8).toISOString() });
    clock.set(local(9, 12)); // Tue Jun 9
    const data = chartData(repo, kid.id, clock);
    // Window Jun 3..9: 100, -80 on Jun 4 -> 20, 20, 20, 20, reset Jun 8 -> 100, 100
    expect(data.map((d) => d.balance)).toEqual([100, 20, 20, 20, 20, 100, 100]);
  });
});
