import type { Txn } from '../types';
import { formatSigned, groupByDay, timeLabel } from '../lib';

/**
 * The ledger. Adjustments show the parent's note verbatim; weekly resets are
 * styled as quiet system entries so history is never ambiguous. When
 * `onDelete` is provided (parents), adjustment rows get a delete affordance.
 */
export default function TransactionList({
  txns,
  showActor = false,
  onDelete,
}: {
  txns: Txn[];
  showActor?: boolean;
  onDelete?: (txn: Txn) => void;
}) {
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
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-faint">
                      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                        <path
                          d="M13.5 8a5.5 5.5 0 1 1-1.61-3.89M13.5 1.5v3h-3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
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
                    {onDelete && (
                      <button
                        type="button"
                        onClick={() => onDelete(t)}
                        aria-label={`Delete entry: ${t.note || formatSigned(t.amount)}`}
                        className="-mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-negative-soft hover:text-negative"
                      >
                        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
                          <path
                            d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4M6.5 7v4.5M9.5 7v4.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    )}
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
