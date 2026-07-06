import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import Avatar from './Avatar';

/** The circle avatar on the top right, with Settings and Log out. */
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

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        className="flex min-h-11 min-w-11 items-center justify-center rounded-full"
      >
        <Avatar name={user.name} src={user.avatar} size={36} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-56 rounded-panel border border-line bg-surface p-1.5 shadow-modal"
        >
          <div className="px-3 py-2">
            <p className="font-semibold text-ink">{user.name}</p>
            <p className="truncate text-[11.5px] text-muted">{user.email}</p>
          </div>
          <hr className="my-1 border-grid" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/settings');
            }}
            className="w-full rounded-ctl px-3 py-2.5 text-left text-ink2 hover:bg-surface2"
          >
            Settings
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void signOut().then(() => navigate('/login'));
            }}
            className="w-full rounded-ctl px-3 py-2.5 text-left text-ink2 hover:bg-surface2"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
