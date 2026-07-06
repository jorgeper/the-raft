import { useEffect, useState } from 'react';
import { formatTimerMs } from '../lib';
import type { DayRecord } from '../types';

/**
 * Elapsed time is always derived from stored timestamps — never an
 * in-memory counter — so it survives reloads and device switches.
 */
export function elapsedMs(day: DayRecord, now: number = Date.now()): number {
  if (day.timerState !== 'running' || !day.timerStartedAt) return day.timerElapsedMs;
  return day.timerElapsedMs + (now - new Date(day.timerStartedAt).getTime());
}

export default function TimerBar({
  day,
  onChange,
}: {
  day: DayRecord;
  onChange: (patch: Partial<DayRecord>) => void;
}) {
  const [, tick] = useState(0);

  useEffect(() => {
    if (day.timerState !== 'running') return;
    const interval = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(interval);
  }, [day.timerState]);

  function start() {
    onChange({ timerState: 'running', timerStartedAt: new Date().toISOString() });
  }

  function stop() {
    onChange({
      timerState: 'stopped',
      timerElapsedMs: elapsedMs(day),
      timerStartedAt: null,
      timerStoppedAt: new Date().toISOString(),
    });
  }

  function reset() {
    onChange({ timerState: 'idle', timerStartedAt: null, timerElapsedMs: 0, timerStoppedAt: null });
  }

  const btn = 'rounded-ctl px-3.5 py-1.5 text-[12.5px] font-[550]';

  return (
    <div className="flex items-center justify-between rounded-card border border-line bg-surface px-3.5 py-2.5 shadow-card">
      <div>
        <p className="text-[10.5px] uppercase tracking-wider text-muted">Workout timer</p>
        <p
          data-testid="timer-display"
          className={`tnum font-serif text-[20px] font-[650] tracking-[-0.3px] ${
            day.timerState === 'stopped' ? 'text-muted' : 'text-ink'
          }`}
        >
          {formatTimerMs(elapsedMs(day))}
        </p>
      </div>
      <div className="flex gap-2">
        {day.timerState !== 'running' && (
          <button type="button" onClick={start} className={`${btn} bg-ink text-page`}>
            {day.timerState === 'stopped' ? 'Resume' : 'Start'}
          </button>
        )}
        {day.timerState === 'running' && (
          <button type="button" onClick={stop} className={`${btn} bg-accent-tint text-accent-deep`}>
            Stop
          </button>
        )}
        {day.timerState === 'stopped' && (
          <button type="button" onClick={reset} className={`${btn} bg-surface3 text-ink2`}>
            Reset
          </button>
        )}
      </div>
    </div>
  );
}
