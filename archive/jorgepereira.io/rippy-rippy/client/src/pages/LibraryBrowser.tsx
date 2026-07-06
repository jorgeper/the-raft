import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Pills from '../components/Pills';
import { useLibrary } from '../hooks/useLibrary';
import type { LibraryExercise } from '../types';

type FilterKey = 'movementPattern' | 'muscleGroup' | 'exerciseType' | 'equipment';

const FILTER_GROUPS: Array<[FilterKey, string]> = [
  ['movementPattern', 'Movement'],
  ['muscleGroup', 'Muscle'],
  ['exerciseType', 'Type'],
  ['equipment', 'Equipment'],
];

export default function LibraryBrowser() {
  const library = useLibrary();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Partial<Record<FilterKey, string>>>({});
  const [calisthenics, setCalisthenics] = useState(false);

  const options = useMemo(() => {
    const out: Record<FilterKey, string[]> = {
      movementPattern: [],
      muscleGroup: [],
      exerciseType: [],
      equipment: [],
    };
    for (const key of Object.keys(out) as FilterKey[]) {
      out[key] = [...new Set((library?.exercises ?? []).map((e) => e[key]).filter((v): v is string => Boolean(v)))].sort();
    }
    return out;
  }, [library]);

  if (!library) return <p className="py-10 text-center text-muted">Loading…</p>;

  const q = query.trim().toLowerCase();
  const filtered = library.exercises
    .filter((ex) => !q || ex.name.toLowerCase().includes(q))
    .filter((ex) => FILTER_GROUPS.every(([key]) => !filters[key] || ex[key] === filters[key]))
    .filter((ex) => !calisthenics || ex.calisthenics)
    .sort((a, b) => a.name.localeCompare(b.name));

  function toggle(key: FilterKey, value: string) {
    setFilters((f) => ({ ...f, [key]: f[key] === value ? undefined : value }));
  }

  const chip = (active: boolean) =>
    'rounded-chip border px-3 py-1 text-[12px] ' +
    (active ? 'border-accent bg-accent-tint text-ink' : 'border-line bg-surface2 text-ink2 hover:bg-surface3');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-[17px] font-[600] tracking-[-0.2px] text-ink">Exercise library</h1>
        <Link to="/settings" className="text-[12px]">
          ← Settings
        </Link>
      </div>

      <input
        type="search"
        placeholder="Search exercises…"
        aria-label="Search the library"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-ctl border border-line bg-surface2 px-3 py-2 text-ink"
      />

      {FILTER_GROUPS.map(([key, label]) => (
        <div key={key} className="flex flex-wrap items-center gap-1.5">
          <span className="w-20 flex-none text-[10.5px] uppercase tracking-wider text-muted">{label}</span>
          {options[key].map((value) => (
            <button key={value} type="button" onClick={() => toggle(key, value)} className={chip(filters[key] === value)}>
              {value}
            </button>
          ))}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-20 flex-none text-[10.5px] uppercase tracking-wider text-muted">Style</span>
        <button type="button" onClick={() => setCalisthenics((v) => !v)} className={chip(calisthenics)}>
          Calisthenics
        </button>
      </div>

      <p className="tnum text-[11.5px] text-muted">
        {filtered.length} exercise{filtered.length === 1 ? '' : 's'}
      </p>

      <div className="flex flex-col gap-2">
        {filtered.length === 0 && (
          <p className="py-6 text-center text-[12px] text-muted">Nothing matches those filters.</p>
        )}
        {filtered.map((ex: LibraryExercise) => (
          <button
            key={ex.name}
            type="button"
            onClick={() => navigate(`/settings/library/${encodeURIComponent(ex.name)}`)}
            className="rounded-card border border-line bg-surface p-3 text-left shadow-card hover:bg-surface2"
          >
            <span className="block font-[550] text-ink">{ex.name}</span>
            <span className="mt-1 block">
              <Pills exercise={ex} />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
