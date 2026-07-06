import type { LibraryExercise } from '../types';

/** The library metadata chips on exercise cards and suggestions. */
export default function Pills({ exercise }: { exercise: LibraryExercise }) {
  const pills = [
    exercise.movementPattern,
    exercise.muscleGroup,
    exercise.exerciseType,
    exercise.equipment,
    exercise.calisthenics ? 'Calisthenics' : null,
  ].filter((p): p is string => Boolean(p));
  if (pills.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {pills.map((p) => (
        <span
          key={p}
          className="inline-block whitespace-nowrap rounded-full bg-surface3 px-2 py-px text-[10px] text-ink2"
        >
          {p}
        </span>
      ))}
    </span>
  );
}
