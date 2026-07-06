import { useState, type FormEvent } from 'react';
import Modal from './Modal';
import { addTransaction } from '../api';

export type Direction = 'add' | 'withdraw';

interface Props {
  kidId: number;
  kidName: string;
  direction: Direction;
  onClose: () => void;
  onDone: (direction: Direction) => void;
}

export default function AmountModal({ kidId, kidName, direction, onClose, onDone }: Props) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adding = direction === 'add';
  const title = adding ? `Give ${kidName} Buckos` : `Take Buckos from ${kidName}`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) {
      setError('Enter a whole number of Buckos, at least 1.');
      return;
    }
    if (!note.trim()) {
      setError('Add a note so everyone remembers why.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addTransaction(kidId, { amount: n, note: note.trim(), direction });
      onDone(direction);
    } catch {
      setError('That didn’t save. Check the connection and try again.');
      setBusy(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="amount">
          How many Buckos?
        </label>
        <div className="relative mb-4">
          <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 font-display text-lg text-ink-faint">
            Ƀ
          </span>
          <input
            id="amount"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="10"
            className="min-h-12 w-full rounded-card border border-line bg-surface pr-4 pl-10 font-display text-lg text-ink placeholder:text-ink-faint focus:border-accent"
          />
        </div>

        <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="note">
          What for?
        </label>
        <input
          id="note"
          type="text"
          required
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={adding ? 'Helped with dishes' : 'Left bike in the rain'}
          className="mb-4 min-h-12 w-full rounded-card border border-line bg-surface px-4 text-ink placeholder:text-ink-faint focus:border-accent"
        />

        {error && (
          <p role="alert" className="mb-4 rounded-chip bg-negative-soft px-3 py-2 text-sm text-negative">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-12 flex-1 rounded-pill border border-line font-medium text-ink transition-colors hover:bg-sunken"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className={`min-h-12 flex-1 rounded-pill font-medium text-accent-ink transition-colors disabled:opacity-60 ${
              adding ? 'bg-accent hover:bg-accent-strong' : 'bg-negative hover:opacity-90'
            }`}
          >
            {busy ? 'Saving…' : adding ? 'Give Buckos' : 'Take Buckos'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
