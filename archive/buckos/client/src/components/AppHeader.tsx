import { Link } from 'react-router-dom';
import AccountMenu from './AccountMenu';

export default function AppHeader({ homeTo = '/' }: { homeTo?: string }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
      <Link to={homeTo} className="flex items-center rounded-chip" aria-label="Ƀuckos home">
        <span className="font-display text-2xl font-semibold tracking-tight text-ink">Ƀuckos</span>
      </Link>
      <AccountMenu />
    </header>
  );
}
