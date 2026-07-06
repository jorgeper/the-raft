import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getExerciseStats, saveWorkout } from '../api';
import AddExerciseModal from '../components/AddExerciseModal';
import ExerciseCard from '../components/ExerciseCard';
import LoadWorkoutModal from '../components/LoadWorkoutModal';
import MonthView from '../components/MonthView';
import SaveWorkoutModal from '../components/SaveWorkoutModal';
import TimerBar from '../components/TimerBar';
import { useDayRecord } from '../hooks/useDayRecord';
import { useSettings } from '../hooks/useSettings';
import { formatDateShort, shiftDateStr, todayStr, uid } from '../lib';
import type { DayRecord, ExerciseStat, SavedWorkout, Suggestion } from '../types';

export default function Day() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') ?? todayStr();
  const { day, mutate, syncState } = useDayRecord(date);
  const settings = useSettings();
  const [adding, setAdding] = useState(false);
  const [loadingWorkout, setLoadingWorkout] = useState(false);
  const [savingWorkout, setSavingWorkout] = useState(false);
  const [view, setView] = useState<'day' | 'month'>('day');
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

  async function loadWorkout(workout: SavedWorkout) {
    // Pre-fill each exercise with the last-used weight/reps for this date.
    const { stats } = await getExerciseStats(date, workout.exercises);
    mutate((d) => ({
      ...d,
      workoutName: workout.name,
      exercises: workout.exercises.map((name) => {
        const last = stats[name]?.lastSession ?? null;
        return { id: uid(), exerciseName: name, sets: last ? [{ weight: last.weight, reps: last.reps }] : [] };
      }),
    }));
    setLoadingWorkout(false);
  }

  async function saveAsWorkout(name: string) {
    if (!day || day.exercises.length === 0) return;
    await saveWorkout(
      name,
      day.exercises.map((e) => e.exerciseName)
    );
    mutate((d) => ({ ...d, workoutName: name }));
    setSavingWorkout(false);
  }

  const navBtn = 'rounded-ctl px-3 py-1.5 text-[15px] text-ink2 hover:bg-surface2';
  const toolBtn = 'rounded-ctl bg-surface2 px-3 py-1.5 text-[12px] font-[550] text-ink2 hover:bg-surface3';

  if (view === 'month') {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h1 className="font-serif text-[17px] font-[600] tracking-[-0.2px] text-ink">Calendar</h1>
          <button type="button" className={toolBtn} onClick={() => setView('day')}>
            Back to day
          </button>
        </div>
        <MonthView
          selectedDate={date}
          onPick={(picked) => {
            goTo(picked);
            setView('day');
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <button type="button" aria-label="Previous day" className={navBtn} onClick={() => goTo(shiftDateStr(date, -1))}>
          ←
        </button>
        <button type="button" className="text-center" onClick={() => setView('month')} aria-label="Open calendar">
          <h1 className="font-serif text-[17px] font-[600] tracking-[-0.2px] text-ink">
            {isToday ? 'Today' : formatDateShort(date)} <span className="text-[11px] text-muted">▾</span>
          </h1>
          {day?.workoutName && <p className="text-[11.5px] text-muted">{day.workoutName}</p>}
        </button>
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
          <div className="flex justify-end gap-1.5">
            <button type="button" className={toolBtn} onClick={() => setLoadingWorkout(true)}>
              Load workout
            </button>
            {day.exercises.length > 0 && (
              <button type="button" className={toolBtn} onClick={() => setSavingWorkout(true)}>
                Save as workout
              </button>
            )}
          </div>

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

      {loadingWorkout && (
        <LoadWorkoutModal onPick={(w) => void loadWorkout(w)} onClose={() => setLoadingWorkout(false)} />
      )}

      {savingWorkout && day && (
        <SaveWorkoutModal
          initialName={day.workoutName ?? ''}
          exercises={day.exercises.map((e) => e.exerciseName)}
          onSave={saveAsWorkout}
          onClose={() => setSavingWorkout(false)}
        />
      )}
    </div>
  );
}
