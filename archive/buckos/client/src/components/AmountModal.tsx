import { useState, type FormEvent } from 'react';
import Modal from './Modal';
import { addTransaction } from '../api';

export type Direction = 'add' | 'withdraw';

const QUICK_AMOUNTS = [1, 5, 10];

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
  const title = adding ? `Give ${kidName} Ƀuckos` : `Take Ƀuckos from ${kidName}`;

  const current = () => {
    const n = Number(amount);
    return Number.isInteger(n) && n > 0 ? n : 0;
  };
  const step = (delta: number) => {
    setError(null);
    setAmount(String(Math.max(1, current() + delta)));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0) {
      setError('Enter a whole number of Ƀuckos, at least 1.');
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
          How many Ƀuckos?
        </label>
        <div className="mb-3 flex items-stretch gap-2">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label="One less Ƀucko"
            className="flex h-14 w-16 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-2xl font-semibold text-ink transition-colors hover:bg-sunken active:bg-sunken"
          >
            −
          </button>
          <input
            id="amount"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="h-14 w-full min-w-0 rounded-card border border-line bg-surface text-center font-display text-2xl text-ink [appearance:textfield] placeholder:text-ink-faint focus:border-accent [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            type="button"
            onClick={() => step(1)}
            aria-label="One more Ƀucko"
            className="flex h-14 w-16 shrink-0 items-center justify-center rounded-card border border-line bg-surface text-2xl font-semibold text-ink transition-colors hover:bg-sunken active:bg-sunken"
          >
            +
          </button>
        </div>

        <div className="mb-5 flex gap-2">
          {QUICK_AMOUNTS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => {
                setError(null);
                setAmount(String(n));
              }}
              className={`min-h-11 flex-1 rounded-pill border font-medium transition-colors ${
                current() === n
                  ? 'border-accent bg-accent-soft text-accent-strong'
                  : 'border-line bg-surface text-ink hover:bg-sunken'
              }`}
            >
              Ƀ{n}
            </button>
          ))}
        </div>

        <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="note">
          What for? <span className="font-normal text-ink-faint">(optional)</span>
        </label>
        <input
          id="note"
          type="text"
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
            {busy ? 'Saving…' : adding ? 'Give Ƀuckos' : 'Take Ƀuckos'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
