import { useEffect, useState, type FormEvent } from 'react';
import Modal from './Modal';
import AvatarPicker from './AvatarPicker';
import { createKid, getSettings, updateKid, ApiError } from '../api';
import type { Kid } from '../types';

interface Props {
  kid?: Kid; // present when editing
  onClose: () => void;
  onSaved: () => void;
}

const ERROR_COPY: Record<string, string> = {
  'email-in-use': 'Another kid already uses that Gmail address.',
  'invalid-email': 'That doesn’t look like an email address.',
  'name-required': 'Give the kid a name.',
  'invalid-allowance': 'Weekly allowance must be a whole number, 0 or more.',
};

export default function KidFormModal({ kid, onClose, onSaved }: Props) {
  const [name, setName] = useState(kid?.name ?? '');
  const [email, setEmail] = useState(kid?.email ?? '');
  const [allowance, setAllowance] = useState(String(kid?.weeklyAllowance ?? 100));
  const [avatar, setAvatar] = useState<string | null>(kid?.avatar ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New kids start from the family-wide default allowance (see Settings).
  useEffect(() => {
    if (!kid) {
      void getSettings()
        .then(({ weeklyAllowance }) => setAllowance(String(weeklyAllowance)))
        .catch(() => {});
    }
  }, [kid]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const weeklyAllowance = Number(allowance);
    if (!name.trim()) return setError(ERROR_COPY['name-required']);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError(ERROR_COPY['invalid-email']);
    if (!Number.isInteger(weeklyAllowance) || weeklyAllowance < 0) return setError(ERROR_COPY['invalid-allowance']);

    setBusy(true);
    setError(null);
    try {
      if (kid) await updateKid(kid.id, { name: name.trim(), email: email.trim(), weeklyAllowance, avatar });
      else await createKid({ name: name.trim(), email: email.trim(), weeklyAllowance, avatar });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? (ERROR_COPY[err.code] ?? 'That didn’t save. Try again.') : 'That didn’t save. Try again.');
      setBusy(false);
    }
  };

  return (
    <Modal title={kid ? `Edit ${kid.name}` : 'Add a kid'} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <div className="mb-4">
          <AvatarPicker name={name} value={avatar} onChange={setAvatar} />
        </div>

        <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="kid-name">
          Name
        </label>
        <input
          id="kid-name"
          type="text"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Maya"
          className="mb-4 min-h-12 w-full rounded-card border border-line bg-surface px-4 text-ink placeholder:text-ink-faint focus:border-accent"
        />

        <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="kid-email">
          Gmail address
        </label>
        <input
          id="kid-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="maya@gmail.com"
          className="mb-1 min-h-12 w-full rounded-card border border-line bg-surface px-4 text-ink placeholder:text-ink-faint focus:border-accent"
        />
        <p className="mb-4 text-sm text-ink-faint">They’ll use this Google account to see their Ƀuckos.</p>

        <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="kid-allowance">
          Weekly allowance
        </label>
        <div className="relative mb-4">
          <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 font-display text-lg text-ink-faint">
            Ƀ
          </span>
          <input
            id="kid-allowance"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            required
            value={allowance}
            onChange={(e) => setAllowance(e.target.value)}
            className="min-h-12 w-full rounded-card border border-line bg-surface pr-4 pl-10 font-display text-lg text-ink focus:border-accent"
          />
        </div>
        <p className="mb-4 -mt-2 text-sm text-ink-faint">Their balance resets to this every Monday.</p>

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
            className="min-h-12 flex-1 rounded-pill bg-accent font-medium text-accent-ink transition-colors hover:bg-accent-strong disabled:opacity-60"
          >
            {busy ? 'Saving…' : kid ? 'Save changes' : 'Add kid'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
