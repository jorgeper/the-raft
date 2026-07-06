import { Link } from 'react-router-dom';
import type { KidWithDerived } from '../types';
import Avatar from './Avatar';
import BalanceChart from './BalanceChart';
import { formatBuckos } from '../lib';

interface Props {
  kid: KidWithDerived;
  onAdd: () => void;
  onWithdraw: () => void;
}

export default function KidCard({ kid, onAdd, onWithdraw }: Props) {
  return (
    <article className="flex flex-col rounded-sheet border border-line bg-surface p-5 shadow-card transition-shadow hover:shadow-pop">
      <Link to={`/kids/${kid.id}`} className="group -m-2 mb-0 block rounded-card p-2">
        <div className="mb-3 flex items-center gap-3">
          <Avatar name={kid.name} size={44} />
          <div className="min-w-0">
            <h2 className="truncate font-display text-xl font-semibold text-ink group-hover:underline">
              {kid.name}
            </h2>
            <p className="text-sm text-ink-faint">Resets to Ƀ{kid.weeklyAllowance} on Monday</p>
          </div>
        </div>

        <p
          className={`mb-2 font-display text-5xl font-semibold tracking-tight ${
            kid.balance < 0 ? 'text-negative' : 'text-ink'
          }`}
          aria-label={`${kid.name}'s balance: ${kid.balance} Buckos`}
        >
          {formatBuckos(kid.balance)}
        </p>

        <BalanceChart data={kid.chart} height={88} />
      </Link>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onAdd}
          className="min-h-11 flex-1 rounded-pill bg-accent font-medium text-accent-ink transition-colors hover:bg-accent-strong"
        >
          Give
        </button>
        <button
          type="button"
          onClick={onWithdraw}
          className="min-h-11 flex-1 rounded-pill border border-line font-medium text-ink transition-colors hover:bg-sunken"
        >
          Take
        </button>
      </div>
    </article>
  );
}
