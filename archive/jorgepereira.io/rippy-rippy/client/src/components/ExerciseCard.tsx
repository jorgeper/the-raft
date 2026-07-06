import type { DayExercise, ExerciseStat, WeightUnit } from '../types';
import { findLibraryExercise, useLibrary } from '../hooks/useLibrary';
import NumberField from './NumberField';
import Pills from './Pills';
import TrendArrow from './TrendArrow';

export default function ExerciseCard({
  exercise,
  stat,
  unit,
  isFirst,
  isLast,
  onChange,
  onRemove,
  onMove,
}: {
  exercise: DayExercise;
  stat: ExerciseStat | undefined;
  unit: WeightUnit;
  isFirst: boolean;
  isLast: boolean;
  onChange: (next: DayExercise) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const library = useLibrary();
  const libEx = findLibraryExercise(library, exercise.exerciseName);
  const last = stat?.lastSession ?? null;

  function updateSet(idx: number, patch: Partial<{ weight: number; reps: number }>) {
    onChange({
      ...exercise,
      sets: exercise.sets.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    });
  }

  function addSet() {
    const prev = exercise.sets[exercise.sets.length - 1] ?? null;
    const seed = prev ?? (last ? { weight: last.weight, reps: last.reps } : { weight: 0, reps: 0 });
    onChange({ ...exercise, sets: [...exercise.sets, { ...seed }] });
  }

  function removeSet(idx: number) {
    onChange({ ...exercise, sets: exercise.sets.filter((_, i) => i !== idx) });
  }

  const moveBtn = 'rounded-ctl px-2 py-1 text-[13px] text-ink2 hover:bg-surface2 disabled:opacity-30';

  return (
    <div data-testid="exercise-card" className="rounded-card border border-line bg-surface p-3.5 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <span className="font-[600] text-ink">{exercise.exerciseName}</span>
        <span className="flex flex-none items-center gap-0.5">
          <button type="button" aria-label="Move up" className={moveBtn} disabled={isFirst} onClick={() => onMove(-1)}>
            ↑
          </button>
          <button type="button" aria-label="Move down" className={moveBtn} disabled={isLast} onClick={() => onMove(1)}>
            ↓
          </button>
          <button
            type="button"
            aria-label={`Remove ${exercise.exerciseName}`}
            className="rounded-ctl px-2 py-1 text-[13px] text-ink2 hover:bg-crit-bg hover:text-crit"
            onClick={onRemove}
          >
            ✕
          </button>
        </span>
      </div>

      {libEx && (
        <div className="mt-1">
          <Pills exercise={libEx} />
        </div>
      )}

      <p className="mt-1.5 text-[11.5px] text-muted">
        {last ? (
          <>
            Last: <span className="tnum">{last.weight}</span> {unit} × <span className="tnum">{last.reps}</span>{' '}
            <TrendArrow trend={stat?.trend ?? 'flat'} />
          </>
        ) : (
          'First time!'
        )}
      </p>

      <div className="mt-2 flex flex-col gap-1.5">
        {exercise.sets.map((set, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="w-11 text-[10.5px] uppercase tracking-wider text-muted">Set {idx + 1}</span>
            <NumberField
              value={set.weight}
              onChange={(weight) => updateSet(idx, { weight })}
              ariaLabel={`${exercise.exerciseName} set ${idx + 1} weight`}
            />
            <span className="text-[11.5px] text-muted">{unit}</span>
            <span className="text-muted">×</span>
            <NumberField
              value={set.reps}
              integer
              onChange={(reps) => updateSet(idx, { reps })}
              ariaLabel={`${exercise.exerciseName} set ${idx + 1} reps`}
              className="w-14"
            />
            <button
              type="button"
              aria-label={`Remove set ${idx + 1}`}
              className="ml-auto rounded-ctl px-2 py-1 text-[13px] text-muted hover:bg-crit-bg hover:text-crit"
              onClick={() => removeSet(idx)}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addSet}
        className="mt-2.5 w-full rounded-ctl border border-dashed border-baseline py-2 text-[12.5px] font-[550] text-ink2 hover:bg-surface2"
      >
        + Add set
      </button>
    </div>
  );
}
