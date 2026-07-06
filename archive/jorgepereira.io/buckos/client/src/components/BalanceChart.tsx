import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import type { ChartPoint } from '../types';

function weekdayLetter(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'narrow' });
}

function fullDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function barFill(p: ChartPoint): string {
  if (p.balance < 0) return 'var(--negative)';
  return p.isToday ? 'var(--accent)' : 'var(--chart-bar-muted)';
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
}

function ChartTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-chip border border-line bg-surface px-3 py-1.5 shadow-pop">
      <p className="text-xs text-ink-muted">{p.isToday ? 'Today' : fullDay(p.date)}</p>
      <p className="font-display text-base font-semibold text-ink">
        {p.balance < 0 ? '−' : ''}Ƀ {Math.abs(p.balance)}
      </p>
    </div>
  );
}

export default function BalanceChart({ data, height = 96 }: { data: ChartPoint[]; height?: number }) {
  const hasNegative = data.some((d) => d.balance < 0);
  const today = data.find((d) => d.isToday);

  return (
    <div
      role="img"
      aria-label={`Balance over the last 7 days. Today: ${today?.balance ?? 0} Buckos.`}
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }} barCategoryGap="18%">
          <XAxis
            dataKey="date"
            tickFormatter={weekdayLetter}
            axisLine={false}
            tickLine={false}
            interval={0}
            tick={{ fontSize: 11, fill: 'var(--ink-faint)', fontFamily: 'var(--font-body)' }}
            height={18}
          />
          {hasNegative && <ReferenceLine y={0} stroke="var(--line)" strokeWidth={1} />}
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--surface-sunken)', opacity: 0.7 }} />
          <Bar dataKey="balance" radius={3} isAnimationActive={false} minPointSize={2}>
            {data.map((p) => (
              <Cell key={p.date} fill={barFill(p)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
