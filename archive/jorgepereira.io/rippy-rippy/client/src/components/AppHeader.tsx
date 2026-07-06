import { Link } from 'react-router-dom';
import AccountMenu from './AccountMenu';

/** Sticky translucent header: wordmark left, avatar menu right. */
export default function AppHeader() {
  return (
    <header
      className="sticky top-0 z-20 border-b border-line"
      style={{ background: 'rgba(250,249,245,.94)', backdropFilter: 'blur(10px)' }}
    >
      <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-2">
        <Link
          to="/"
          className="font-serif text-[17px] font-semibold tracking-[-0.2px] text-accent-deep no-underline"
        >
          Rippy Rippy
        </Link>
        <AccountMenu />
      </div>
    </header>
  );
}
