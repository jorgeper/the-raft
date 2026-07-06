import { useEffect, useState } from 'react';
import { getAnalytics, getHistory } from '../api';
import Modal from '../components/Modal';
import SeriesChart, { type ChartSeries } from '../components/SeriesChart';
import { useSettings } from '../hooks/useSettings';
import type { HistoryPoint, PersonalRecord, WorkoutStats } from '../types';

const SERIES_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s5)', 'var(--s6)', 'var(--s8)'];

export default function Analytics() {
  const settings = useSettings();
  const [stats, setStats] = useState<WorkoutStats | null>(null);
  const [records, setRecords] = useState<PersonalRecord[]>([]);
  const [allNames, setAllNames] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [history, setHistory] = useState<Record<string, HistoryPoint[]>>({});
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void getAnalytics().then(({ stats, records, exerciseNames }) => {
      setStats(stats);
      setRecords(records);
      setAllNames(exerciseNames);
      // Start with the top PR exercise charted so the screen isn't empty.
      if (records.length > 0) setSelected([records[0].name]);
    });
  }, []);

  useEffect(() => {
    if (selected.length === 0) {
      setHistory({});
      return;
    }
    let cancelled = false;
    void getHistory(selected).then(({ history }) => {
      if (!cancelled) setHistory(history);
    });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const series: ChartSeries[] = selected.map((name, idx) => ({
    name,
    color: SERIES_COLORS[idx % SERIES_COLORS.length],
    history: history[name] ?? [],
  }));

  const unit = settings.weightUnit;
  const q = query.trim().toLowerCase();
  const pickable = allNames
    .filter((n) => !selected.some((s) => s.toLowerCase() === n.toLowerCase()))
    .filter((n) => !q || n.toLowerCase().includes(q));

  if (stats === null) return <p className="py-10 text-center text-muted">Loading…</p>;

  const hasAnyData = stats.totalDays > 0;

  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-serif text-[17px] font-[600] tracking-[-0.2px] text-ink">Analytics</h1>

      <div className="grid grid-cols-3 gap-3">
        {(
          [
            [stats.totalDays, 'Workouts', 'stat-workouts'],
            [stats.uniqueExercises, 'Exercises', 'stat-exercises'],
            [stats.bestStreak, 'Best streak', 'stat-streak'],
          ] as const
        ).map(([value, label, testId]) => (
          <div key={label} className="rounded-card border border-line bg-surface p-3 text-center shadow-card">
            <p data-testid={testId} className="tnum text-[20px] font-[650] tracking-[-0.3px] text-ink">
              {value}
            </p>
            <p className="text-[10.5px] uppercase tracking-wider text-muted">{label}</p>
          </div>
        ))}
      </div>

      {!hasAnyData && (
        <div
          className="rounded-card border border-line bg-note px-4 py-3 text-[12px] text-ink2"
          style={{ borderLeft: '3px solid var(--accent)' }}
        >
          Nothing to chart yet — log a few days and your records and progression will show up here.
        </div>
      )}

      {records.length > 0 && (
        <div className="rounded-card border border-line bg-surface p-3.5 shadow-card">
          <h2 className="text-[12.5px] font-[600] text-ink2">Personal records</h2>
          <div className="mt-2 flex flex-col">
            {records.map((r) => (
              <div key={r.name} className="flex items-center justify-between border-b border-grid py-1.5 last:border-b-0">
                <span className="text-[12.5px] text-ink">{r.name}</span>
                <span className="tnum text-[12.5px] font-[600] text-ink">
                  {r.maxWeight} {unit}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {hasAnyData && (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {selected.map((name, idx) => (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 rounded-chip border border-line bg-surface2 px-3 py-1 text-[12px] text-ink2"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: SERIES_COLORS[idx % SERIES_COLORS.length] }}
                />
                {name}
                <button
                  type="button"
                  aria-label={`Remove ${name} from charts`}
                  onClick={() => setSelected(selected.filter((n) => n !== name))}
                  className="text-muted hover:text-crit"
                >
                  ✕
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setPicking(true);
              }}
              className="rounded-chip border border-accent bg-accent-tint px-3 py-1 text-[12px] text-ink"
            >
              + Chart an exercise
            </button>
          </div>

          {selected.length > 0 && (
            <>
              <div className="rounded-card border border-line bg-surface p-3.5 shadow-card">
                <h2 className="mb-2 text-[12.5px] font-[600] text-ink2">
                  Max weight over time <span className="font-normal text-muted">({unit})</span>
                </h2>
                <SeriesChart series={series} valueKey="maxWeight" ariaLabel="Max weight progression chart" />
              </div>
              <div className="rounded-card border border-line bg-surface p-3.5 shadow-card">
                <h2 className="mb-2 text-[12.5px] font-[600] text-ink2">
                  Total volume over time{' '}
                  <span className="font-normal text-muted">(weight × reps, {unit})</span>
                </h2>
                <SeriesChart series={series} valueKey="totalVolume" ariaLabel="Volume progression chart" />
              </div>
            </>
          )}
        </>
      )}

      {picking && (
        <Modal title="Chart an exercise" onClose={() => setPicking(false)}>
          <input
            type="search"
            autoFocus
            placeholder="Search your exercises…"
            aria-label="Search exercises to chart"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-ctl border border-line bg-surface2 px-3 py-2 text-ink"
          />
          <div className="mt-2 flex max-h-[50dvh] flex-col gap-0.5 overflow-auto">
            {pickable.length === 0 && (
              <p className="py-6 text-center text-[12px] text-muted">No matching exercises in your history.</p>
            )}
            {pickable.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => {
                  setSelected([...selected, name]);
                  setPicking(false);
                }}
                className="rounded-ctl px-3 py-2 text-left font-[550] text-ink hover:bg-surface2"
              >
                {name}
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
