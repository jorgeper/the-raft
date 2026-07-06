import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import Avatar from './Avatar';

export default function AccountMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!user) return null;
  const displayName = user.name ?? user.email.split('@')[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        className="flex min-h-11 min-w-11 items-center justify-center rounded-full transition-transform hover:scale-105"
      >
        <Avatar name={displayName} size={40} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-60 rounded-card border border-line bg-surface p-2 shadow-pop"
        >
          <div className="px-3 py-2">
            <p className="font-semibold text-ink">{displayName}</p>
            <p className="truncate text-sm text-ink-muted">{user.email}</p>
          </div>
          <hr className="my-1 border-line" />
          {user.role === 'parent' && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate('/settings');
              }}
              className="w-full rounded-chip px-3 py-2.5 text-left text-ink transition-colors hover:bg-sunken"
            >
              Settings
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void signOut().then(() => navigate('/login'));
            }}
            className="w-full rounded-chip px-3 py-2.5 text-left text-ink transition-colors hover:bg-sunken"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
