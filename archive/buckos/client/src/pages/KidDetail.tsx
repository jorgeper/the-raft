import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getKidDetail, removeKid } from '../api';
import type { KidDetail as KidDetailData } from '../types';
import AppHeader from '../components/AppHeader';
import Avatar from '../components/Avatar';
import BalanceChart from '../components/BalanceChart';
import TransactionList from '../components/TransactionList';
import AmountModal, { type Direction } from '../components/AmountModal';
import KidFormModal from '../components/KidFormModal';
import ConfirmDialog from '../components/ConfirmDialog';
import Celebration from '../components/Celebration';
import { formatBuckos } from '../lib';

export default function KidDetail() {
  const { id } = useParams();
  const kidId = Number(id);
  const navigate = useNavigate();
  const [data, setData] = useState<KidDetailData | null>(null);
  const [missing, setMissing] = useState(false);
  const [direction, setDirection] = useState<Direction | null>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getKidDetail(kidId));
    } catch {
      setMissing(true);
    }
  }, [kidId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (missing) {
    return (
      <div className="min-h-screen">
        <AppHeader />
        <main className="mx-auto max-w-xl px-4 py-16 text-center">
          <h1 className="font-display text-2xl font-semibold text-ink">That kid isn’t here anymore</h1>
          <Link to="/" className="mt-4 inline-block text-accent underline">
            Back to the family
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-16">
      <AppHeader />
      <main className="mx-auto w-full max-w-2xl px-4 sm:px-6">
        <Link to="/" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-ink-muted transition-colors hover:text-ink">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M9 2L4 7l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          The family
        </Link>

        {data === null ? (
          <div className="h-96 animate-pulse rounded-sheet border border-line bg-surface" aria-busy="true" />
        ) : (
          <>
            <section className="mb-6 rounded-sheet border border-line bg-surface p-5 shadow-card sm:p-6">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <Avatar name={data.kid.name} size={52} />
                <div className="min-w-0 flex-1 basis-[calc(100%-4rem)] sm:basis-auto">
                  <h1 className="truncate font-display text-2xl font-semibold text-ink">{data.kid.name}</h1>
                  <p className="truncate text-sm text-ink-faint">
                    {data.kid.email} · resets to Ƀ{data.kid.weeklyAllowance} on Monday
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className="min-h-11 rounded-pill border border-line px-4 font-medium text-ink transition-colors hover:bg-sunken"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setRemoving(true)}
                    className="min-h-11 rounded-pill border border-line px-4 font-medium text-negative transition-colors hover:bg-negative-soft"
                  >
                    Remove
                  </button>
                </div>
              </div>

              <p
                className={`mb-3 font-display text-6xl font-semibold tracking-tight ${
                  data.balance < 0 ? 'text-negative' : 'text-ink'
                }`}
              >
                {formatBuckos(data.balance)}
              </p>
              {data.balance < 0 && (
                <p className="mb-3 -mt-1 text-sm text-negative">In Ƀucko debt — good deeds pay it down.</p>
              )}

              <BalanceChart data={data.chart} height={120} />

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => setDirection('add')}
                  className="min-h-12 flex-1 rounded-pill bg-accent font-medium text-accent-ink transition-colors hover:bg-accent-strong"
                >
                  Give Ƀuckos
                </button>
                <button
                  type="button"
                  onClick={() => setDirection('withdraw')}
                  className="min-h-12 flex-1 rounded-pill border border-line font-medium text-ink transition-colors hover:bg-sunken"
                >
                  Take Ƀuckos
                </button>
              </div>
            </section>

            <section>
              <h2 className="mb-2 px-1 font-display text-xl font-semibold text-ink">Ledger</h2>
              <TransactionList txns={data.transactions} showActor />
            </section>
          </>
        )}
      </main>

      {direction && data && (
        <AmountModal
          kidId={data.kid.id}
          kidName={data.kid.name}
          direction={direction}
          onClose={() => setDirection(null)}
          onDone={(d) => {
            setDirection(null);
            if (d === 'add') setCelebrating(true);
            void load();
          }}
        />
      )}

      {editing && data && (
        <KidFormModal
          kid={data.kid}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      )}

      {removing && data && (
        <ConfirmDialog
          title={`Remove ${data.kid.name}?`}
          body={`${data.kid.name} won’t be able to sign in anymore and will disappear from the dashboard. Their history is kept in the bank’s books.`}
          confirmLabel="Remove kid"
          busy={removeBusy}
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            setRemoveBusy(true);
            void removeKid(data.kid.id)
              .then(() => navigate('/', { replace: true }))
              .catch(() => setRemoveBusy(false));
          }}
        />
      )}

      {celebrating && <Celebration onDone={() => setCelebrating(false)} />}
    </div>
  );
}
