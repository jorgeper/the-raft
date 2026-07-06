import type { Trend } from '../types';

export default function TrendArrow({ trend }: { trend: Trend }) {
  if (trend === 'up') return <span className="text-good">↑</span>;
  if (trend === 'down') return <span className="text-crit">↓</span>;
  return <span className="text-muted">→</span>;
}
