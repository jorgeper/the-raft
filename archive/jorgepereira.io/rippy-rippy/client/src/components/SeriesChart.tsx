import type { HistoryPoint } from '../types';

export interface ChartSeries {
  name: string;
  color: string; // a CSS var reference like 'var(--s1)'
  history: HistoryPoint[];
}

const PAD = { left: 40, right: 10, top: 10, bottom: 26 };
const W = 320;
const H = 200;

/**
 * Multi-series progression chart, ported from the original inline-SVG
 * implementation but drawn with theme tokens (SPEC §7 bug #5): series colors
 * are --s1…--s8, grid and labels come from --grid/--muted.
 */
export default function SeriesChart({
  series,
  valueKey,
  ariaLabel,
}: {
  series: ChartSeries[];
  valueKey: 'maxWeight' | 'totalVolume';
  ariaLabel: string;
}) {
  const withData = series.filter((s) => s.history.length > 0);
  if (withData.length === 0) return null;

  const allDates = Array.from(new Set(withData.flatMap((s) => s.history.map((h) => h.date)))).sort();
  const minDate = new Date(allDates[0] + 'T12:00:00').getTime();
  const maxDate = new Date(allDates[allDates.length - 1] + 'T12:00:00').getTime();
  const dateRange = Math.max(1, (maxDate - minDate) / 86_400_000);

  let minVal = Infinity;
  let maxVal = -Infinity;
  for (const s of withData) {
    for (const h of s.history) {
      minVal = Math.min(minVal, h[valueKey]);
      maxVal = Math.max(maxVal, h[valueKey]);
    }
  }
  const valPad = (maxVal - minVal) * 0.1 || 10;
  minVal = Math.max(0, minVal - valPad);
  maxVal = maxVal + valPad;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (date: string) =>
    allDates.length === 1
      ? PAD.left + plotW / 2
      : PAD.left + ((new Date(date + 'T12:00:00').getTime() - minDate) / 86_400_000 / dateRange) * plotW;
  const y = (val: number) => PAD.top + plotH - ((val - minVal) / (maxVal - minVal || 1)) * plotH;
  const baseY = PAD.top + plotH;

  const gridLines = [0, 1, 2, 3, 4].map((i) => minVal + ((maxVal - minVal) * i) / 4);
  const labelStep = Math.max(1, Math.ceil(allDates.length / 5));
  const xLabels = allDates.filter((_, i) => i % labelStep === 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="w-full">
      <defs>
        {withData.map((s, idx) => (
          <linearGradient key={s.name} id={`area-${valueKey}-${idx}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>

      {gridLines.map((val) => (
        <g key={val}>
          <line x1={PAD.left} y1={y(val)} x2={W - PAD.right} y2={y(val)} stroke="var(--grid)" strokeWidth="1" />
          <text x={PAD.left - 4} y={y(val) + 3} textAnchor="end" fontSize="8" fill="var(--muted)">
            {Math.round(val)}
          </text>
        </g>
      ))}

      {xLabels.map((date) => {
        const d = new Date(date + 'T12:00:00');
        return (
          <text key={date} x={x(date)} y={H - 6} textAnchor="middle" fontSize="8" fill="var(--muted)">
            {d.getMonth() + 1}/{d.getDate()}
          </text>
        );
      })}

      {withData.map((s, idx) => {
        const pts = s.history.map((h) => ({ px: x(h.date), py: y(h[valueKey]) }));
        const line = pts.map((p) => `${p.px},${p.py}`).join(' ');
        const area =
          pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.px},${p.py}`).join(' ') +
          ` L${pts[pts.length - 1].px},${baseY} L${pts[0].px},${baseY} Z`;
        return (
          <g key={s.name}>
            {pts.length > 1 && <path d={area} fill={`url(#area-${valueKey}-${idx})`} />}
            {pts.length > 1 && (
              <polyline
                points={line}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {pts.map((p, i) => (
              <circle key={i} cx={p.px} cy={p.py} r="3" fill={s.color} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
