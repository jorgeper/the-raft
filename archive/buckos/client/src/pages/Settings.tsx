import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { getSettings, updateSettings } from '../api';
import AppHeader from '../components/AppHeader';

export default function Settings() {
  const [allowance, setAllowance] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getSettings()
      .then(({ weeklyAllowance }) => setAllowance(String(weeklyAllowance)))
      .catch(() => setError('Couldn’t load settings. Refresh to try again.'));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = Number(allowance);
    if (!Number.isInteger(n) || n < 0) {
      setError('The weekly allowance must be a whole number, 0 or more.');
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateSettings({ weeklyAllowance: n });
      setSaved(true);
    } catch {
      setError('That didn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen pb-16">
      <AppHeader />
      <main className="mx-auto w-full max-w-2xl px-4 sm:px-6">
        <Link
          to="/"
          className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-ink-muted transition-colors hover:text-ink"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M9 2L4 7l5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </Link>

        <h1 className="mb-4 font-display text-3xl font-semibold tracking-tight text-ink">Settings</h1>

        <section className="rounded-sheet border border-line bg-surface p-5 shadow-card sm:p-6">
          <form onSubmit={submit} noValidate>
            <label className="mb-1.5 block font-medium text-ink" htmlFor="weekly-allowance">
              Weekly allowance
            </label>
            <p className="mb-3 text-sm text-ink-muted">
              Every kid’s balance resets to this many Ƀuckos each Monday. Changing it applies to all
              kids — you can still fine-tune one kid from their page.
            </p>
            <div className="relative mb-4 max-w-48">
              <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 font-display text-lg text-ink-faint">
                Ƀ
              </span>
              <input
                id="weekly-allowance"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                required
                disabled={allowance === null}
                value={allowance ?? ''}
                onChange={(e) => {
                  setAllowance(e.target.value);
                  setSaved(false);
                }}
                className="h-14 w-full rounded-card border border-line bg-surface pr-4 pl-10 font-display text-2xl text-ink [appearance:textfield] focus:border-accent disabled:opacity-60 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>

            {error && (
              <p role="alert" className="mb-4 rounded-chip bg-negative-soft px-3 py-2 text-sm text-negative">
                {error}
              </p>
            )}
            {saved && (
              <p role="status" className="mb-4 rounded-chip bg-positive-soft px-3 py-2 text-sm text-positive">
                Saved. Balances pick up the new allowance at the next Monday reset.
              </p>
            )}

            <button
              type="submit"
              disabled={busy || allowance === null}
              className="min-h-12 rounded-pill bg-accent px-8 font-medium text-accent-ink transition-colors hover:bg-accent-strong disabled:opacity-60"
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
