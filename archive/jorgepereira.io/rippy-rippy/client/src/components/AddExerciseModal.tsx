import { useEffect, useMemo, useState } from 'react';
import { getSuggestions } from '../api';
import { findLibraryExercise, useLibrary } from '../hooks/useLibrary';
import type { Suggestion, WeightUnit } from '../types';
import Modal from './Modal';
import Pills from './Pills';
import TrendArrow from './TrendArrow';

/**
 * Search across all known exercises (library + the user's own history),
 * with last-session context, or create a brand-new name.
 */
export default function AddExerciseModal({
  date,
  excludeNames,
  unit,
  onPick,
  onClose,
}: {
  date: string;
  excludeNames: string[];
  unit: WeightUnit;
  onPick: (suggestion: Suggestion) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const library = useLibrary();

  useEffect(() => {
    let cancelled = false;
    void getSuggestions(date).then(({ suggestions }) => {
      if (!cancelled) setSuggestions(suggestions);
    });
    return () => {
      cancelled = true;
    };
  }, [date]);

  const excluded = useMemo(() => new Set(excludeNames.map((n) => n.toLowerCase())), [excludeNames]);
  const q = query.trim().toLowerCase();

  const filtered = (suggestions ?? [])
    .filter((s) => !excluded.has(s.name.toLowerCase()))
    .filter((s) => !q || s.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  const exactMatch = filtered.some((s) => s.name.toLowerCase() === q);
  const canCreate = q.length > 0 && !exactMatch && !excluded.has(q);

  function createNew() {
    onPick({ name: query.trim(), inLibrary: false, lastSession: null, trend: 'flat' });
  }

  return (
    <Modal title="Add exercise" onClose={onClose}>
      <input
        type="search"
        autoFocus
        placeholder="Search or type a new exercise…"
        aria-label="Search exercises"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-ctl border border-line bg-surface2 px-3 py-2 text-ink"
      />

      {canCreate && (
        <button
          type="button"
          onClick={createNew}
          className="mt-2 w-full rounded-ctl bg-ink px-3 py-2.5 text-left text-[12.5px] font-[550] text-page"
        >
          Add “{query.trim()}”
        </button>
      )}

      <div className="mt-2 flex max-h-[50dvh] flex-col gap-0.5 overflow-auto">
        {suggestions === null && <p className="py-6 text-center text-[12px] text-muted">Loading…</p>}
        {suggestions !== null && filtered.length === 0 && !canCreate && (
          <p className="py-6 text-center text-[12px] text-muted">
            No matches — type a name to create a new exercise.
          </p>
        )}
        {filtered.map((s) => {
          const libEx = findLibraryExercise(library, s.name);
          return (
            <button
              key={s.name}
              type="button"
              onClick={() => onPick(s)}
              className="flex items-center justify-between gap-2 rounded-ctl px-3 py-2 text-left hover:bg-surface2"
            >
              <span className="min-w-0">
                <span className="block truncate font-[550] text-ink">{s.name}</span>
                {libEx && <Pills exercise={libEx} />}
              </span>
              {s.lastSession && (
                <span className="tnum flex-none text-[11.5px] text-muted">
                  {s.lastSession.weight} {unit} <TrendArrow trend={s.trend} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
