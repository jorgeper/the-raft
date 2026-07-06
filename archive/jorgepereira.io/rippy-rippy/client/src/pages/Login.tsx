import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { devLogin, getAuthMode, getDevUsers } from '../api';
import { useAuth } from '../auth';
import Avatar from '../components/Avatar';
import type { DevUser } from '../types';

export default function Login() {
  const { user, loading, refresh } = useAuth();
  const [mode, setMode] = useState<'dev' | 'google' | null>(null);
  const [devUsers, setDevUsers] = useState<DevUser[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    void getAuthMode().then(({ mode }) => {
      setMode(mode);
      if (mode === 'dev') void getDevUsers().then(({ users }) => setDevUsers(users));
    });
  }, []);

  useEffect(() => {
    if (!loading && user) navigate('/', { replace: true });
  }, [loading, user, navigate]);

  async function pickUser(email: string) {
    await devLogin(email);
    await refresh();
    navigate('/', { replace: true });
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-10">
      <h1 className="font-serif text-[30px] font-[650] tracking-[-0.5px] text-ink">Rippy Rippy</h1>
      <p className="mt-1 text-[12.8px] text-ink2">Your training book. Every rep remembered.</p>

      {mode === 'google' && (
        <a
          href="/auth/google"
          className="mt-8 rounded-ctl bg-ink px-5 py-3 text-[13px] font-[550] text-page no-underline"
        >
          Sign in with Google
        </a>
      )}

      {mode === 'dev' && (
        <div className="mt-8 w-full max-w-sm rounded-card border border-line bg-surface p-4 shadow-card">
          <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted">
            Dev mode — pick a user
          </p>
          <div className="mt-2 flex flex-col gap-1">
            {devUsers.map((u) => (
              <button
                key={u.email}
                type="button"
                onClick={() => void pickUser(u.email)}
                className="flex items-center gap-3 rounded-ctl px-3 py-2.5 text-left hover:bg-surface2"
              >
                <Avatar name={u.name} src={u.avatar} size={32} />
                <span>
                  <span className="block font-[550] text-ink">{u.name}</span>
                  <span className="block text-[11.5px] text-muted">{u.email}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
