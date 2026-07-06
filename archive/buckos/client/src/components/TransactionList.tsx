import type { Txn } from '../types';
import { formatSigned, groupByDay, timeLabel } from '../lib';
import Coin from './Coin';

/**
 * The ledger. Adjustments show the parent's note verbatim; weekly resets are
 * styled as quiet system entries so history is never ambiguous.
 */
export default function TransactionList({ txns, showActor = false }: { txns: Txn[]; showActor?: boolean }) {
  if (txns.length === 0) {
    return <p className="py-8 text-center text-ink-faint">No Ƀuckos moved yet.</p>;
  }

  return (
    <div>
      {groupByDay(txns).map((group) => (
        <section key={group.label + group.txns[0].id}>
          <h3 className="sticky top-0 bg-page/95 px-1 py-2 text-sm font-medium tracking-wide text-ink-faint backdrop-blur-sm">
            {group.label}
          </h3>
          <ul className="mb-2 overflow-hidden rounded-card border border-line bg-surface">
            {group.txns.map((t) => (
              <li key={t.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
                {t.type === 'reset' ? (
                  <>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sunken">
                      <Coin size={18} className="opacity-70" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-ink-muted italic">{t.note}</span>
                      <span className="block text-sm text-ink-faint">Allowance · {timeLabel(t.createdAt)}</span>
                    </span>
                    <span className="font-display text-base font-semibold whitespace-nowrap text-ink-faint">
                      {formatSigned(t.amount)}
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      aria-hidden="true"
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${
                        t.amount >= 0 ? 'bg-positive-soft text-positive' : 'bg-negative-soft text-negative'
                      }`}
                    >
                      {t.amount >= 0 ? '+' : '−'}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate font-medium ${t.note ? 'text-ink' : 'text-ink-faint italic'}`}>
                        {t.note || (t.amount >= 0 ? 'Ƀuckos given' : 'Ƀuckos taken')}
                      </span>
                      <span className="block truncate text-sm text-ink-faint">
                        {timeLabel(t.createdAt)}
                        {showActor && t.actorEmail ? ` · by ${t.actorEmail.split('@')[0]}` : ''}
                      </span>
                    </span>
                    <span
                      className={`font-display text-base font-semibold whitespace-nowrap ${
                        t.amount >= 0 ? 'text-positive' : 'text-negative'
                      }`}
                    >
                      {formatSigned(t.amount)}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
