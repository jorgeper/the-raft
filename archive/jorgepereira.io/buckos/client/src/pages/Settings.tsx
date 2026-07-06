import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { getKidProfile, getProfile, getSettings, updateKidAvatar, updateProfile, updateSettings } from '../api';
import { useAuth } from '../auth';
import AppHeader from '../components/AppHeader';
import AvatarPicker from '../components/AvatarPicker';

export default function Settings() {
  const { user } = useAuth();
  if (user?.role === 'kid') return <KidSettings />;
  return <ParentSettings />;
}

function ParentSettings() {
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

        <ProfileSection />

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

function KidSettings() {
  const { user, refresh } = useAuth();
  const [avatar, setAvatar] = useState<string | null>(null);
  const [googlePicture, setGooglePicture] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getKidProfile()
      .then((p) => {
        setAvatar(p.avatar);
        setGooglePicture(p.googlePicture);
      })
      .catch(() => setError('Couldn’t load your picture. Refresh to try again.'));
  }, []);

  const save = async (next: string | null) => {
    setAvatar(next);
    setSaved(false);
    setError(null);
    try {
      await updateKidAvatar(next);
      await refresh();
      setSaved(true);
    } catch {
      setError('That didn’t save. Try again.');
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
          <h2 className="mb-1 font-medium text-ink">Your picture</h2>
          <p className="mb-4 text-sm text-ink-muted">How you appear across Ƀuckos.</p>
          <AvatarPicker
            name={user?.name ?? ''}
            value={avatar}
            fallbackSrc={googlePicture}
            onChange={(v) => void save(v)}
          />
          {error && (
            <p role="alert" className="mt-4 rounded-chip bg-negative-soft px-3 py-2 text-sm text-negative">
              {error}
            </p>
          )}
          {saved && (
            <p role="status" className="mt-4 rounded-chip bg-positive-soft px-3 py-2 text-sm text-positive">
              Picture saved.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}

function ProfileSection() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [googlePicture, setGooglePicture] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getProfile()
      .then((p) => {
        setName(p.name ?? user?.email.split('@')[0] ?? '');
        setAvatar(p.avatar);
        setGooglePicture(p.googlePicture);
      })
      .catch(() => setError('Couldn’t load your profile. Refresh to try again.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name?.trim()) {
      setError('Your name can’t be empty.');
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await updateProfile({ name: name.trim(), avatar });
      await refresh(); // header avatar + name update immediately
      setSaved(true);
    } catch {
      setError('That didn’t save. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mb-6 rounded-sheet border border-line bg-surface p-5 shadow-card sm:p-6">
      <h2 className="mb-1 font-medium text-ink">Your profile</h2>
      <p className="mb-4 text-sm text-ink-muted">How you appear across Ƀuckos.</p>

      <form onSubmit={submit} noValidate>
        <div className="mb-4">
          <AvatarPicker
            name={name ?? ''}
            value={avatar}
            fallbackSrc={googlePicture}
            onChange={(v) => {
              setAvatar(v);
              setSaved(false);
            }}
          />
        </div>

        <label className="mb-1.5 block text-sm font-medium text-ink" htmlFor="profile-name">
          Your name
        </label>
        <input
          id="profile-name"
          type="text"
          required
          disabled={name === null}
          value={name ?? ''}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          className="mb-4 min-h-12 w-full max-w-sm rounded-card border border-line bg-surface px-4 text-ink placeholder:text-ink-faint focus:border-accent disabled:opacity-60"
        />

        {error && (
          <p role="alert" className="mb-4 rounded-chip bg-negative-soft px-3 py-2 text-sm text-negative">
            {error}
          </p>
        )}
        {saved && (
          <p role="status" className="mb-4 rounded-chip bg-positive-soft px-3 py-2 text-sm text-positive">
            Profile saved.
          </p>
        )}

        <button
          type="submit"
          disabled={busy || name === null}
          className="min-h-12 rounded-pill bg-accent px-8 font-medium text-accent-ink transition-colors hover:bg-accent-strong disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </form>
    </section>
  );
}
