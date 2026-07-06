import { useEffect, useState } from 'react';
import { deleteWorkout, getWorkouts, saveWorkout, updateWorkout } from '../api';
import ConfirmDialog from '../components/ConfirmDialog';
import EditWorkoutModal from '../components/EditWorkoutModal';
import type { SavedWorkout } from '../types';

export default function Workouts() {
  const [workouts, setWorkouts] = useState<SavedWorkout[] | null>(null);
  const [editing, setEditing] = useState<SavedWorkout | null | 'new'>(null);
  const [deleting, setDeleting] = useState<SavedWorkout | null>(null);

  async function reload() {
    const { workouts } = await getWorkouts();
    setWorkouts(workouts);
  }

  useEffect(() => {
    void reload();
  }, []);

  async function handleSave(name: string, exercises: string[]) {
    if (editing !== 'new' && editing) {
      await updateWorkout(editing.id, name, exercises);
    } else {
      await saveWorkout(name, exercises);
    }
    setEditing(null);
    await reload();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-[17px] font-[600] tracking-[-0.2px] text-ink">Saved workouts</h1>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="rounded-ctl bg-ink px-3.5 py-2 text-[12.5px] font-[550] text-page"
        >
          + New workout
        </button>
      </div>

      {workouts === null && <p className="py-10 text-center text-muted">Loading…</p>}

      {workouts !== null && workouts.length === 0 && (
        <div
          className="rounded-card border border-line bg-note px-4 py-3 text-[12px] text-ink2"
          style={{ borderLeft: '3px solid var(--accent)' }}
        >
          No saved workouts yet. Build one here, or log a day and use “Save as workout” — either way
          it becomes a one-tap template.
        </div>
      )}

      {workouts?.map((w) => (
        <div key={w.id} className="rounded-card border border-line bg-surface p-3.5 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <span className="font-[600] text-ink">{w.name}</span>
            <span className="flex flex-none gap-1">
              <button
                type="button"
                onClick={() => setEditing(w)}
                className="rounded-ctl bg-surface2 px-3 py-1 text-[12px] text-ink2 hover:bg-surface3"
              >
                Edit
              </button>
              <button
                type="button"
                aria-label={`Delete ${w.name}`}
                onClick={() => setDeleting(w)}
                className="rounded-ctl px-2 py-1 text-[13px] text-muted hover:bg-crit-bg hover:text-crit"
              >
                ✕
              </button>
            </span>
          </div>
          <p className="mt-1 text-[12px] text-muted">{w.exercises.join(', ')}</p>
        </div>
      ))}

      {editing !== null && (
        <EditWorkoutModal
          workout={editing === 'new' ? null : editing}
          onSave={handleSave}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete workout?"
          message={`“${deleting.name}” will be removed from your saved workouts. Days you already logged with it keep their data.`}
          confirmLabel="Delete"
          onConfirm={() => {
            void deleteWorkout(deleting.id).then(() => {
              setDeleting(null);
              void reload();
            });
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
