import { useState } from 'react';
import Modal from './Modal';

/** Save the current day's exercise list as a named template. */
export default function SaveWorkoutModal({
  initialName,
  exercises,
  onSave,
  onClose,
}: {
  initialName: string;
  exercises: string[];
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the workout a name.');
      return;
    }
    await onSave(trimmed);
  }

  return (
    <Modal title="Save as workout" onClose={onClose}>
      <p className="text-[12px] text-ink2">
        Saves <b className="text-ink">{exercises.join(', ')}</b> as a reusable template. Saving under
        an existing name updates that workout.
      </p>
      <input
        type="text"
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Push Day"
        aria-label="Workout name"
        className="mt-3 w-full rounded-ctl border border-line bg-surface2 px-3 py-2 text-ink"
        onKeyDown={(e) => {
          if (e.key === 'Enter') void save();
        }}
      />
      {error && <p className="mt-2 text-[12px] text-crit">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-ctl bg-surface3 px-4 py-2 text-[12.5px] font-[550] text-ink2">
          Cancel
        </button>
        <button type="button" onClick={() => void save()} className="rounded-ctl bg-ink px-4 py-2 text-[12.5px] font-[550] text-page">
          Save
        </button>
      </div>
    </Modal>
  );
}
