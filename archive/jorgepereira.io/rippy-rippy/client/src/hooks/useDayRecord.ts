import { useCallback, useEffect, useRef, useState } from 'react';
import { getDay } from '../api';
import type { DayRecord } from '../types';

export type SyncState = 'idle' | 'saving' | 'error';

export function emptyDay(date: string): DayRecord {
  return {
    date,
    workoutName: null,
    exercises: [],
    timerState: 'idle',
    timerStartedAt: null,
    timerElapsedMs: 0,
    timerStoppedAt: null,
  };
}

const DEBOUNCE_MS = 500;
const RETRY_MS = 3000;

async function putDayRaw(day: DayRecord, keepalive = false): Promise<boolean> {
  try {
    const res = await fetch(`/api/days/${day.date}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(day),
      keepalive,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * The sync model (SPEC §6): the server is the source of truth, the current
 * day lives in memory, edits apply optimistically and are PUT debounced,
 * with a keepalive flush when the page hides and retry-with-backoff on
 * failure. Untouched days are never persisted.
 */
export function useDayRecord(date: string) {
  const [day, setDay] = useState<DayRecord | null>(null); // null while loading
  const [syncState, setSyncState] = useState<SyncState>('idle');

  const dayRef = useRef<DayRecord | null>(null);
  const dirtyRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const save = useCallback(async () => {
    const current = dayRef.current;
    if (!current || !dirtyRef.current) return;
    dirtyRef.current = false;
    setSyncState('saving');
    const ok = await putDayRaw(current);
    if (ok) {
      // New edits may have landed while the PUT was in flight; if so a
      // debounced save is already scheduled and will run.
      setSyncState(dirtyRef.current ? 'saving' : 'idle');
    } else {
      dirtyRef.current = true;
      setSyncState('error');
      if (retryRef.current) clearTimeout(retryRef.current);
      retryRef.current = setTimeout(() => void save(), RETRY_MS);
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void save(), DEBOUNCE_MS);
  }, [save]);

  /** Apply an edit to the day and queue it for sync. */
  const mutate = useCallback(
    (fn: (day: DayRecord) => DayRecord) => {
      setDay((prev) => {
        const base = prev ?? emptyDay(date);
        const next = fn(base);
        dayRef.current = next;
        return next;
      });
      dirtyRef.current = true;
      scheduleSave();
    },
    [date, scheduleSave]
  );

  // Load on date change, flushing any pending edits for the previous date.
  useEffect(() => {
    if (dirtyRef.current && dayRef.current) {
      void putDayRaw(dayRef.current);
      dirtyRef.current = false;
    }
    dayRef.current = null;
    setDay(null);
    setSyncState('idle');
    let cancelled = false;
    void getDay(date)
      .then((loaded) => {
        if (cancelled) return;
        const record = loaded ?? emptyDay(date);
        dayRef.current = record;
        setDay(record);
      })
      .catch(() => {
        if (cancelled) return;
        const record = emptyDay(date);
        dayRef.current = record;
        setDay(record);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  // Flush with keepalive when the tab hides or the page unloads.
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current && dayRef.current) {
        void putDayRaw(dayRef.current, true);
        dirtyRef.current = false;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      flush();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (retryRef.current) clearTimeout(retryRef.current);
    };
  }, []);

  return { day, mutate, syncState };
}
