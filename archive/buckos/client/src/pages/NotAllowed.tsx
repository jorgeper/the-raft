import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import Coin from '../components/Coin';

export default function NotAllowed() {
  const navigate = useNavigate();
  const { signOut } = useAuth();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div className="max-w-sm">
        <div className="mb-4 inline-flex opacity-60 grayscale">
          <Coin size={56} />
        </div>
        <h1 className="font-display text-3xl font-semibold text-ink">You're not on the list yet</h1>
        <p className="mt-3 text-ink-muted">
          Buckos is invite-only for each family. Ask a parent to add your Gmail address, then sign in
          again.
        </p>
        <button
          type="button"
          onClick={() => {
            void signOut().finally(() => navigate('/login'));
          }}
          className="mt-6 min-h-12 rounded-pill bg-accent px-6 font-medium text-accent-ink transition-colors hover:bg-accent-strong"
        >
          Try a different account
        </button>
      </div>
    </main>
  );
}
