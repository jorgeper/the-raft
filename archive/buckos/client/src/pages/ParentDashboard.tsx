import { useCallback, useEffect, useState } from 'react';
import { listKids } from '../api';
import type { KidWithDerived } from '../types';
import AppHeader from '../components/AppHeader';
import KidCard from '../components/KidCard';
import AmountModal, { type Direction } from '../components/AmountModal';
import KidFormModal from '../components/KidFormModal';
import Celebration from '../components/Celebration';
import Coin from '../components/Coin';

type AmountTarget = { kid: KidWithDerived; direction: Direction } | null;

export default function ParentDashboard() {
  const [kids, setKids] = useState<KidWithDerived[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [amountTarget, setAmountTarget] = useState<AmountTarget>(null);
  const [showAddKid, setShowAddKid] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoadError(false);
      const { kids } = await listKids();
      setKids(kids);
    } catch {
      setLoadError(true);
      setKids([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen pb-16">
      <AppHeader />
      <main className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        {kids !== null && kids.length > 0 && (
          <div className="mb-4 flex items-center justify-end">
            <button
              type="button"
              onClick={() => setShowAddKid(true)}
              className="min-h-11 rounded-pill border border-line bg-surface px-5 font-medium text-ink transition-colors hover:border-accent hover:text-accent"
            >
              + Add kid
            </button>
          </div>
        )}

        {kids === null && <SkeletonGrid />}

        {loadError && (
          <p role="alert" className="mb-4 rounded-card bg-negative-soft px-4 py-3 text-negative">
            Couldn’t load the family. <button className="underline" onClick={() => void load()}>Retry</button>
          </p>
        )}

        {kids !== null && !loadError && kids.length === 0 && (
          <EmptyState onAdd={() => setShowAddKid(true)} />
        )}

        {kids !== null && kids.length > 0 && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {kids.map((kid) => (
              <KidCard
                key={kid.id}
                kid={kid}
                onAdd={() => setAmountTarget({ kid, direction: 'add' })}
                onWithdraw={() => setAmountTarget({ kid, direction: 'withdraw' })}
              />
            ))}
          </div>
        )}
      </main>

      {amountTarget && (
        <AmountModal
          kidId={amountTarget.kid.id}
          kidName={amountTarget.kid.name}
          direction={amountTarget.direction}
          onClose={() => setAmountTarget(null)}
          onDone={(direction) => {
            setAmountTarget(null);
            if (direction === 'add') setCelebrating(true);
            void load();
          }}
        />
      )}

      {showAddKid && (
        <KidFormModal
          onClose={() => setShowAddKid(false)}
          onSaved={() => {
            setShowAddKid(false);
            void load();
          }}
        />
      )}

      {celebrating && <Celebration onDone={() => setCelebrating(false)} />}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid animate-pulse grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-72 rounded-sheet border border-line bg-surface" />
      ))}
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mx-auto max-w-md rounded-sheet border border-dashed border-line bg-surface px-6 py-14 text-center">
      <div className="mb-4 inline-flex">
        <Coin size={56} />
      </div>
      <h2 className="font-display text-2xl font-semibold text-ink">Start the family bank</h2>
      <p className="mt-2 mb-6 text-ink-muted">
        Add your first kid and they’ll get their weekly allowance of Ƀuckos right away.
      </p>
      <button
        type="button"
        onClick={onAdd}
        className="min-h-12 rounded-pill bg-accent px-6 font-medium text-accent-ink transition-colors hover:bg-accent-strong"
      >
        Add your first kid
      </button>
    </div>
  );
}
