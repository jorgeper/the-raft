import { Link } from 'react-router-dom';
import Coin from './Coin';
import AccountMenu from './AccountMenu';

export default function AppHeader({ homeTo = '/' }: { homeTo?: string }) {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
      <Link to={homeTo} className="flex items-center gap-2 rounded-chip" aria-label="Buckos home">
        <Coin size={28} />
        <span className="font-display text-2xl font-semibold tracking-tight text-ink">Buckos</span>
      </Link>
      <AccountMenu />
    </header>
  );
}
