import { useEffect, useState } from 'react';
import { getKidSummary } from '../api';
import type { KidSummary } from '../types';
import AppHeader from '../components/AppHeader';
import BalanceChart from '../components/BalanceChart';
import TransactionList from '../components/TransactionList';
import Coin from '../components/Coin';
import { formatBuckos } from '../lib';

/** The kid's whole world: balance, week, ledger. Strictly read-only. */
export default function KidHome() {
  const [data, setData] = useState<KidSummary | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    void getKidSummary()
      .then(setData)
      .catch(() => setError(true));
  }, []);

  return (
    <div className="min-h-screen pb-16">
      <AppHeader />
      <main className="mx-auto w-full max-w-2xl px-4 sm:px-6">
        {error && (
          <p role="alert" className="rounded-card bg-negative-soft px-4 py-3 text-negative">
            Couldn’t load your Buckos. Pull to refresh or try again in a bit.
          </p>
        )}

        {!error && data === null && (
          <div className="h-96 animate-pulse rounded-sheet border border-line bg-surface" aria-busy="true" />
        )}

        {data && (
          <>
            <section className="mb-6 rounded-sheet border border-line bg-surface px-5 py-8 text-center shadow-card">
              <p className="mb-1 text-lg text-ink-muted">
                {greeting()}, {data.kid.name}! You have
              </p>
              <p
                className={`mb-1 inline-flex items-center gap-3 font-display text-7xl font-semibold tracking-tight ${
                  data.balance < 0 ? 'text-negative' : 'text-ink'
                }`}
              >
                <span className="animate-[coin-drop_0.5s_cubic-bezier(0.34,1.56,0.64,1)]">
                  <Coin size={44} />
                </span>
                {formatBuckos(data.balance).replace('Ƀ ', '')}
              </p>
              <p className="text-lg text-ink-muted">Buckos</p>
              {data.balance < 0 ? (
                <p className="mt-3 text-sm text-negative">
                  You’re in Bucko debt — good choices will earn it back.
                </p>
              ) : (
                <p className="mt-3 text-sm text-ink-faint">
                  Your allowance of Ƀ {data.kid.weeklyAllowance} lands every Monday.
                </p>
              )}

              <div className="mt-6">
                <BalanceChart data={data.chart} height={120} />
              </div>
            </section>

            <section>
              <h2 className="mb-2 px-1 font-display text-xl font-semibold text-ink">Your week in Buckos</h2>
              <TransactionList txns={data.transactions} />
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
