import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getExerciseStats } from '../api';
import AddExerciseModal from '../components/AddExerciseModal';
import ExerciseCard from '../components/ExerciseCard';
import TimerBar from '../components/TimerBar';
import { useDayRecord } from '../hooks/useDayRecord';
import { useSettings } from '../hooks/useSettings';
import { formatDateShort, shiftDateStr, todayStr, uid } from '../lib';
import type { DayRecord, ExerciseStat, Suggestion } from '../types';

export default function Day() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayStr();
  const { day, mutate, syncState } = useDayRecord(date);
  const settings = useSettings();
  const [adding, setAdding] = useState(false);
  const [stats, setStats] = useState<Record<string, ExerciseStat>>({});

  const isToday = date === todayStr();

  function goTo(newDate: string) {
    setParams(newDate === todayStr() ? {} : { date: newDate }, { replace: false });
  }

  // Last-session + trend for the exercises on this day.
  const nameKey = useMemo(() => (day?.exercises ?? []).map((e) => e.exerciseName).join('|'), [day]);
  useEffect(() => {
    const names = nameKey ? nameKey.split('|') : [];
    if (names.length === 0) {
      setStats({});
      return;
    }
    let cancelled = false;
    void getExerciseStats(date, names).then(({ stats }) => {
      if (!cancelled) setStats(stats);
    });
    return () => {
      cancelled = true;
    };
  }, [nameKey, date]);

  function patchDay(patch: Partial<DayRecord>) {
    mutate((d) => ({ ...d, ...patch }));
  }

  function addExercise(s: Suggestion) {
    mutate((d) => ({
      ...d,
      exercises: [
        ...d.exercises,
        {
          id: uid(),
          exerciseName: s.name,
          sets: s.lastSession ? [{ weight: s.lastSession.weight, reps: s.lastSession.reps }] : [],
        },
      ],
    }));
    setAdding(false);
  }

  function moveExercise(idx: number, delta: -1 | 1) {
    mutate((d) => {
      const next = [...d.exercises];
      const target = idx + delta;
      if (target < 0 || target >= next.length) return d;
      [next[idx], next[target]] = [next[target], next[idx]];
      return { ...d, exercises: next };
    });
  }

  const navBtn = 'rounded-ctl px-3 py-1.5 text-[15px] text-ink2 hover:bg-surface2';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button type="button" aria-label="Previous day" className={navBtn} onClick={() => goTo(shiftDateStr(date, -1))}>
          ←
        </button>
        <div className="text-center">
          <h1 className="font-serif text-[17px] font-[600] tracking-[-0.2px] text-ink">
            {isToday ? 'Today' : formatDateShort(date)}
          </h1>
          {day?.workoutName && <p className="text-[11.5px] text-muted">{day.workoutName}</p>}
        </div>
        <button type="button" aria-label="Next day" className={navBtn} onClick={() => goTo(shiftDateStr(date, 1))}>
          →
        </button>
      </div>

      <div className="flex min-h-5 items-center justify-center gap-3 text-[11.5px]">
        {!isToday && (
          <button
            type="button"
            onClick={() => goTo(todayStr())}
            className="rounded-full border border-accent bg-accent-tint px-3 py-0.5 text-ink"
          >
            Jump to today
          </button>
        )}
        {syncState === 'saving' && <span className="text-muted">Saving…</span>}
        {syncState === 'error' && <span className="text-warn">Offline — retrying</span>}
      </div>

      {day === null ? (
        <p className="py-10 text-center text-muted">Loading…</p>
      ) : (
        <>
          <TimerBar day={day} onChange={patchDay} />

          {day.exercises.length === 0 && (
            <div
              className="rounded-card border border-line bg-note px-4 py-3 text-[12px] text-ink2"
              style={{ borderLeft: '3px solid var(--accent)' }}
            >
              Rest day so far. Add an exercise to start today’s page in the book.
            </div>
          )}

          {day.exercises.map((ex, idx) => (
            <ExerciseCard
              key={ex.id}
              exercise={ex}
              stat={stats[ex.exerciseName]}
              unit={settings.weightUnit}
              isFirst={idx === 0}
              isLast={idx === day.exercises.length - 1}
              onChange={(next) =>
                mutate((d) => ({ ...d, exercises: d.exercises.map((e, i) => (i === idx ? next : e)) }))
              }
              onRemove={() => mutate((d) => ({ ...d, exercises: d.exercises.filter((_, i) => i !== idx) }))}
              onMove={(delta) => moveExercise(idx, delta)}
            />
          ))}

          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-card border border-line bg-ink py-2.5 text-[13px] font-[550] text-page shadow-card"
          >
            + Add exercise
          </button>
        </>
      )}

      {adding && day && (
        <AddExerciseModal
          date={date}
          excludeNames={day.exercises.map((e) => e.exerciseName)}
          unit={settings.weightUnit}
          onPick={addExercise}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}
