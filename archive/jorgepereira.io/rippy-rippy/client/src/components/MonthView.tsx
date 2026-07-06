import { useEffect, useMemo, useState } from 'react';
import { getDaySummaries } from '../api';
import { toDateStr, todayStr } from '../lib';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Cell {
  date: string;
  dayNum: number;
  inMonth: boolean;
}

function buildCells(year: number, month: number): Cell[] {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Cell[] = [];
  for (let i = firstDow - 1; i >= 0; i--) {
    const d = new Date(year, month, -i);
    cells.push({ date: toDateStr(d), dayNum: d.getDate(), inMonth: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: toDateStr(new Date(year, month, d)), dayNum: d, inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const last = new Date(cells[cells.length - 1].date + 'T12:00:00');
    last.setDate(last.getDate() + 1);
    cells.push({ date: toDateStr(last), dayNum: last.getDate(), inMonth: false });
  }
  return cells;
}

/** Calendar grid with dots on training days; tap a day to open it. */
export default function MonthView({
  selectedDate,
  onPick,
}: {
  selectedDate: string;
  onPick: (date: string) => void;
}) {
  const anchor = new Date(selectedDate + 'T12:00:00');
  const [year, setYear] = useState(anchor.getFullYear());
  const [month, setMonth] = useState(anchor.getMonth());
  const [workoutDates, setWorkoutDates] = useState<Set<string>>(new Set());

  const cells = useMemo(() => buildCells(year, month), [year, month]);
  const today = todayStr();

  useEffect(() => {
    if (cells.length === 0) return;
    let cancelled = false;
    void getDaySummaries(cells[0].date, cells[cells.length - 1].date).then(({ days }) => {
      if (cancelled) return;
      setWorkoutDates(new Set(days.filter((d) => d.exerciseCount > 0).map((d) => d.date)));
    });
    return () => {
      cancelled = true;
    };
  }, [cells]);

  function shiftMonth(delta: number) {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  const title = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const todayInView = new Date(today + 'T12:00:00').getFullYear() === year && new Date(today + 'T12:00:00').getMonth() === month;
  const navBtn = 'rounded-ctl px-3 py-1.5 text-[15px] text-ink2 hover:bg-surface2';

  return (
    <div className="rounded-card border border-line bg-surface p-3.5 shadow-card">
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label="Previous month" className={navBtn} onClick={() => shiftMonth(-1)}>
          ←
        </button>
        <div className="text-center">
          <h2 className="font-serif text-[15px] font-[650] text-ink">{title}</h2>
          {!todayInView && (
            <button
              type="button"
              className="text-[11.5px] text-accent-deep underline"
              onClick={() => {
                const d = new Date(today + 'T12:00:00');
                setYear(d.getFullYear());
                setMonth(d.getMonth());
              }}
            >
              This month
            </button>
          )}
        </div>
        <button type="button" aria-label="Next month" className={navBtn} onClick={() => shiftMonth(1)}>
          →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {DAY_NAMES.map((d) => (
          <div key={d} className="py-1 text-center text-[10.5px] uppercase tracking-wider text-muted">
            {d}
          </div>
        ))}
        {cells.map((cell) => {
          const isToday = cell.date === today;
          const isSelected = cell.date === selectedDate;
          return (
            <button
              key={cell.date}
              type="button"
              onClick={() => onPick(cell.date)}
              aria-label={`Open ${cell.date}`}
              className={
                'flex aspect-square flex-col items-center justify-center rounded-ctl text-[12.5px] ' +
                (isSelected
                  ? 'bg-accent-tint text-ink'
                  : isToday
                    ? 'bg-ink text-page'
                    : cell.inMonth
                      ? 'text-ink hover:bg-surface2'
                      : 'text-muted hover:bg-surface2')
              }
            >
              <span className="tnum">{cell.dayNum}</span>
              <span
                className="mt-0.5 h-1.5 w-1.5 rounded-full"
                style={{
                  background: workoutDates.has(cell.date)
                    ? isToday && !isSelected
                      ? 'var(--page)'
                      : 'var(--accent)'
                    : 'transparent',
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
