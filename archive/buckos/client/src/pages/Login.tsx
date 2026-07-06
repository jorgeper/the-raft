import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { devLogin, getAuthMode, getDevUsers } from '../api';
import { useAuth } from '../auth';
import type { DevUser } from '../types';
import Avatar from '../components/Avatar';

export default function Login() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'dev' | 'google' | null>(null);
  const [devUsers, setDevUsers] = useState<DevUser[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    void getAuthMode()
      .then(async ({ mode }) => {
        setMode(mode);
        if (mode === 'dev') {
          const { users } = await getDevUsers();
          setDevUsers(users);
        }
      })
      .catch(() => setError('Ƀuckos could not reach its server. Refresh to try again.'));
  }, []);

  const pick = async (email: string) => {
    setBusy(email);
    setError(null);
    try {
      await devLogin(email);
      await refresh();
      navigate('/', { replace: true });
    } catch {
      setError('That account is not on the list.');
      setBusy(null);
    }
  };

  const parents = devUsers.filter((u) => u.role === 'parent');
  const kids = devUsers.filter((u) => u.role === 'kid');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="animate-[coin-drop_0.6s_cubic-bezier(0.34,1.56,0.64,1)] font-display text-6xl font-semibold tracking-tight text-ink">
            Ƀuckos
          </h1>
        </div>

        <div className="rounded-sheet border border-line bg-surface p-6 shadow-card">
          {mode === null && !error && <p className="text-center text-ink-muted">Loading…</p>}

          {mode === 'google' && (
            <a
              href="/auth/google"
              className="flex min-h-12 w-full items-center justify-center gap-3 rounded-pill border border-line bg-surface px-6 font-medium text-ink transition-colors hover:bg-sunken"
            >
              <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.7 1.22 9.2 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.2C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.2C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              Sign in with Google
            </a>
          )}

          {mode === 'dev' && (
            <div>
              <p className="mb-3 text-center text-sm font-medium tracking-wide text-ink-faint uppercase">
                Dev mode — pick a user
              </p>
              {parents.length > 0 && <UserGroup label="Parents" users={parents} busy={busy} onPick={pick} />}
              {kids.length > 0 && <UserGroup label="Kids" users={kids} busy={busy} onPick={pick} />}
              {kids.length === 0 && (
                <p className="mt-2 px-1 text-center text-sm text-ink-faint">
                  Kids appear here once a parent adds them.
                </p>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="mt-4 rounded-chip bg-negative-soft px-3 py-2 text-sm text-negative">
              {error}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

function UserGroup({
  label,
  users,
  busy,
  onPick,
}: {
  label: string;
  users: DevUser[];
  busy: string | null;
  onPick: (email: string) => void;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <p className="mb-1.5 px-1 text-sm text-ink-muted">{label}</p>
      <ul className="space-y-1.5">
        {users.map((u) => (
          <li key={u.email}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => onPick(u.email)}
              className="flex min-h-12 w-full items-center gap-3 rounded-card border border-line px-3 py-2 text-left transition-colors hover:border-accent hover:bg-accent-soft disabled:opacity-60"
            >
              <Avatar name={u.name} size={32} />
              <span className="min-w-0">
                <span className="block font-medium text-ink capitalize">{u.name}</span>
                <span className="block truncate text-sm text-ink-muted">{u.email}</span>
              </span>
              {busy === u.email && <span className="ml-auto text-sm text-ink-faint">Signing in…</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
