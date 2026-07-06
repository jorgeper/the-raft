import type { Repo } from './repo';
import type { Kid } from './types';
import type { Clock } from './clock';
import type { Config } from './config';

export const RESET_NOTE = (allowance: number) => `Weekly reset to ${allowance}`;

/**
 * All weekly reset instants t with from < t <= now, in chronological order.
 * A boundary is the configured local day-of-week at the configured local hour.
 */
export function resetBoundariesSince(from: Date, now: Date, resetDay: number, resetHour: number): Date[] {
  // Start from the boundary candidate on `from`'s own day, then walk forward
  // day by day until we hit the right weekday strictly after `from`.
  const candidate = new Date(from.getFullYear(), from.getMonth(), from.getDate(), resetHour, 0, 0, 0);
  while (candidate.getDay() !== resetDay || candidate.getTime() <= from.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }

  const boundaries: Date[] = [];
  while (candidate.getTime() <= now.getTime()) {
    boundaries.push(new Date(candidate));
    candidate.setDate(candidate.getDate() + 7);
  }
  return boundaries;
}

/**
 * Lazily catch up any weekly resets this kid missed. Each missed boundary gets
 * one immutable ledger row stamped at the boundary instant whose delta lands
 * the balance exactly on the kid's weekly allowance. Safe to call on every
 * access; does nothing when the kid is already up to date.
 */
export function ensureResets(repo: Repo, kid: Kid, clock: Clock, cfg: Config): void {
  const fromIso = repo.lastResetAt(kid.id) ?? kid.createdAt;
  const boundaries = resetBoundariesSince(new Date(fromIso), clock.now(), cfg.resetDay, cfg.resetHour);
  if (boundaries.length === 0) return;

  // Replay the ledger chronologically so each boundary sees the balance as of
  // that instant (adjustments recorded between missed boundaries are honored).
  const chronological = repo
    .listTxns(kid.id)
    .slice()
    .reverse();
  let idx = 0;
  let running = 0;

  for (const boundary of boundaries) {
    while (idx < chronological.length && new Date(chronological[idx].createdAt).getTime() <= boundary.getTime()) {
      running += chronological[idx].amount;
      idx++;
    }
    const delta = kid.weeklyAllowance - running;
    repo.addTxn({
      kidId: kid.id,
      amount: delta,
      note: RESET_NOTE(kid.weeklyAllowance),
      type: 'reset',
      actorEmail: null,
      createdAt: boundary.toISOString(),
    });
    running = kid.weeklyAllowance;
  }
}

export interface ChartPoint {
  date: string; // local YYYY-MM-DD
  balance: number; // end-of-day balance (current balance for today)
  isToday: boolean;
}

/** End-of-day balances for the last 7 local days, oldest first, ending today. */
export function chartData(repo: Repo, kidId: number, clock: Clock): ChartPoint[] {
  const chronological = repo
    .listTxns(kidId)
    .slice()
    .reverse();
  const now = clock.now();

  const points: ChartPoint[] = [];
  for (let daysAgo = 6; daysAgo >= 0; daysAgo--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
    const endOfDay = daysAgo === 0 ? now : new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    let balance = 0;
    for (const t of chronological) {
      const at = new Date(t.createdAt).getTime();
      if (daysAgo === 0 ? at <= endOfDay.getTime() : at < endOfDay.getTime()) balance += t.amount;
      else break;
    }
    points.push({ date: localDateKey(day), balance, isToday: daysAgo === 0 });
  }
  return points;
}

function localDateKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
