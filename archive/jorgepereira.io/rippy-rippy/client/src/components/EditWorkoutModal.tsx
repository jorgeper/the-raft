import { useState } from 'react';
import type { SavedWorkout } from '../types';
import AddExerciseModal from './AddExerciseModal';
import Modal from './Modal';
import { todayStr } from '../lib';
import { useSettings } from '../hooks/useSettings';

/** Create or edit a saved workout: name + ordered exercise list. */
export default function EditWorkoutModal({
  workout,
  onSave,
  onClose,
}: {
  workout: SavedWorkout | null; // null = create new
  onSave: (name: string, exercises: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(workout?.name ?? '');
  const [exercises, setExercises] = useState<string[]>(workout?.exercises ?? []);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const settings = useSettings();

  function move(idx: number, delta: -1 | 1) {
    const target = idx + delta;
    if (target < 0 || target >= exercises.length) return;
    const next = [...exercises];
    [next[idx], next[target]] = [next[target], next[idx]];
    setExercises(next);
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the workout a name.');
      return;
    }
    if (exercises.length === 0) {
      setError('Add at least one exercise.');
      return;
    }
    await onSave(trimmed, exercises);
  }

  const smallBtn = 'rounded-ctl px-2 py-1 text-[13px] text-ink2 hover:bg-surface2 disabled:opacity-30';

  return (
    <>
      <Modal title={workout ? 'Edit workout' : 'New workout'} onClose={onClose}>
        <label className="block text-[10.5px] uppercase tracking-wider text-muted">Name</label>
        <input
          type="text"
          value={name}
          autoFocus={!workout}
          onChange={(e) => setName(e.target.value)}
          placeholder="Push Day"
          aria-label="Workout name"
          className="mt-1 w-full rounded-ctl border border-line bg-surface2 px-3 py-2 text-ink"
        />

        <div className="mt-3 flex flex-col gap-1">
          {exercises.map((ex, idx) => (
            <div key={`${ex}-${idx}`} className="flex items-center gap-1 rounded-ctl bg-surface px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate text-[12.8px] text-ink">{ex}</span>
              <button type="button" aria-label={`Move ${ex} up`} className={smallBtn} disabled={idx === 0} onClick={() => move(idx, -1)}>
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${ex} down`}
                className={smallBtn}
                disabled={idx === exercises.length - 1}
                onClick={() => move(idx, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`Remove ${ex}`}
                className="rounded-ctl px-2 py-1 text-[13px] text-muted hover:bg-crit-bg hover:text-crit"
                onClick={() => setExercises(exercises.filter((_, i) => i !== idx))}
              >
                ✕
              </button>
            </div>
          ))}
          {exercises.length === 0 && (
            <p className="py-3 text-center text-[12px] text-muted">No exercises yet.</p>
          )}
        </div>

        <button
          type="button"
          onClick={() => setPicking(true)}
          className="mt-2 w-full rounded-ctl border border-dashed border-baseline py-2 text-[12.5px] font-[550] text-ink2 hover:bg-surface2"
        >
          + Add exercise
        </button>

        {error && <p className="mt-2 text-[12px] text-crit">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-ctl bg-surface3 px-4 py-2 text-[12.5px] font-[550] text-ink2">
            Cancel
          </button>
          <button type="button" onClick={() => void save()} className="rounded-ctl bg-ink px-4 py-2 text-[12.5px] font-[550] text-page">
            Save workout
          </button>
        </div>
      </Modal>

      {picking && (
        <AddExerciseModal
          date={todayStr()}
          excludeNames={exercises}
          unit={settings.weightUnit}
          onPick={(s) => {
            setExercises((prev) => [...prev, s.name]);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}
