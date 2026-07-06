import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import AccountMenu from './AccountMenu';

export default function AppHeader({ homeTo = '/', actions }: { homeTo?: string; actions?: ReactNode }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
      <Link to={homeTo} className="flex items-center rounded-chip" aria-label="Ƀuckos home">
        <span className="font-display text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Ƀuckos</span>
      </Link>
      <div className="flex items-center gap-3">
        {actions}
        <AccountMenu />
      </div>
    </header>
  );
}
