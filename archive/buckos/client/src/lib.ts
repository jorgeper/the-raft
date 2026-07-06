import type { Txn } from './types';

/** "Ƀ 85" or "−Ƀ 15" — the minus sits outside the coin sign. */
export function formatBuckos(n: number): string {
  return `${n < 0 ? '−' : ''}Ƀ ${Math.abs(n)}`;
}

/** "+5" / "−15" for ledger rows. */
export function formatSigned(n: number): string {
  return n >= 0 ? `+${n}` : `−${Math.abs(n)}`;
}

export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export interface TxnGroup {
  label: string;
  txns: Txn[];
}

/** Group a newest-first ledger by calendar day, preserving order. */
export function groupByDay(txns: Txn[], now: Date = new Date()): TxnGroup[] {
  const groups: TxnGroup[] = [];
  for (const t of txns) {
    const label = dayLabel(t.createdAt, now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.txns.push(t);
    else groups.push({ label, txns: [t] });
  }
  return groups;
}
