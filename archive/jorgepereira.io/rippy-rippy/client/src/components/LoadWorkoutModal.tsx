import { useEffect, useState } from 'react';
import { getWorkouts } from '../api';
import type { SavedWorkout } from '../types';
import Modal from './Modal';

export default function LoadWorkoutModal({
  onPick,
  onClose,
}: {
  onPick: (workout: SavedWorkout) => void;
  onClose: () => void;
}) {
  const [workouts, setWorkouts] = useState<SavedWorkout[] | null>(null);

  useEffect(() => {
    void getWorkouts().then(({ workouts }) => setWorkouts(workouts));
  }, []);

  return (
    <Modal title="Load workout" onClose={onClose}>
      {workouts === null && <p className="py-6 text-center text-[12px] text-muted">Loading…</p>}
      {workouts !== null && workouts.length === 0 && (
        <p className="py-6 text-center text-[12px] text-muted">
          No saved workouts yet — create one from the Workouts tab, or log a day and save it.
        </p>
      )}
      <div className="flex flex-col gap-1">
        {workouts?.map((w) => (
          <button
            key={w.id}
            type="button"
            onClick={() => onPick(w)}
            className="rounded-ctl px-3 py-2.5 text-left hover:bg-surface2"
          >
            <span className="block font-[550] text-ink">{w.name}</span>
            <span className="block truncate text-[11.5px] text-muted">{w.exercises.join(', ')}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
