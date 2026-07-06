import { describe, it, expect } from 'vitest';
import {
  getExerciseHistory,
  getLastSession,
  getLoggedExerciseNames,
  getPersonalRecords,
  getTrend,
  getWorkoutStats,
} from '../../server/stats';
import type { DayRecord } from '../../server/types';

function day(date: string, exercises: Array<[name: string, sets: Array<[number, number]>]>): DayRecord {
  return {
    date,
    workoutName: null,
    exercises: exercises.map(([name, sets], i) => ({
      id: `${date}-${i}`,
      exerciseName: name,
      sets: sets.map(([weight, reps]) => ({ weight, reps })),
    })),
    timerState: 'idle',
    timerStartedAt: null,
    timerElapsedMs: 0,
    timerStoppedAt: null,
  };
}

describe('getLastSession', () => {
  it('returns the most recent session strictly before the date', () => {
    const days = [
      day('2026-07-01', [['Bench Press', [[135, 10]]]]),
      day('2026-07-03', [['Bench Press', [[155, 8], [165, 6]]]]),
    ];
    expect(getLastSession(days, 'Bench Press', '2026-07-05')).toEqual({
      weight: 155,
      reps: 8,
      maxWeight: 165,
    });
  });

  it('is insensitive to insertion order (original bug #1 regression)', () => {
    // Days array deliberately NOT in date order — the user edited an old day
    // after logging a newer one.
    const days = [
      day('2026-07-03', [['Bench Press', [[155, 8]]]]),
      day('2026-07-01', [['Bench Press', [[135, 10]]]]),
    ];
    expect(getLastSession(days, 'Bench Press', '2026-07-05')!.weight).toBe(155);
  });

  it('ignores days on or after the reference date (future days, bug #1)', () => {
    const days = [
      day('2026-07-01', [['Bench Press', [[135, 10]]]]),
      day('2026-07-04', [['Bench Press', [[9999, 1]]]]), // planned future day
    ];
    expect(getLastSession(days, 'Bench Press', '2026-07-02')!.weight).toBe(135);
    expect(getLastSession(days, 'Bench Press', '2026-07-04')!.weight).toBe(135);
  });

  it('matches names case-insensitively and skips empty-set sessions', () => {
    const days = [
      day('2026-07-01', [['bench press', [[135, 10]]]]),
      day('2026-07-02', [['Bench Press', []]]),
    ];
    expect(getLastSession(days, 'BENCH PRESS', '2026-07-03')!.weight).toBe(135);
  });

  it('returns null with no earlier history', () => {
    expect(getLastSession([], 'Bench Press', '2026-07-01')).toBeNull();
    const days = [day('2026-07-02', [['Bench Press', [[135, 10]]]])];
    expect(getLastSession(days, 'Bench Press', '2026-07-01')).toBeNull();
  });
});

describe('getTrend', () => {
  it('compares newest vs oldest of the last three sessions', () => {
    const days = [
      day('2026-07-01', [['Squat', [[200, 5]]]]),
      day('2026-07-03', [['Squat', [[210, 5]]]]),
      day('2026-07-05', [['Squat', [[220, 5]]]]),
    ];
    expect(getTrend(days, 'Squat', '2026-07-06')).toBe('up');
  });

  it('reports down and flat correctly regardless of array order', () => {
    const down = [
      day('2026-07-05', [['Squat', [[180, 5]]]]),
      day('2026-07-01', [['Squat', [[220, 5]]]]),
    ];
    expect(getTrend(down, 'Squat', '2026-07-06')).toBe('down');
    const flat = [
      day('2026-07-01', [['Squat', [[200, 5]]]]),
      day('2026-07-05', [['Squat', [[200, 5]]]]),
    ];
    expect(getTrend(flat, 'Squat', '2026-07-06')).toBe('flat');
  });

  it('only looks at the last three sessions', () => {
    const days = [
      day('2026-06-01', [['Squat', [[300, 5]]]]), // old PR, outside the window
      day('2026-07-01', [['Squat', [[200, 5]]]]),
      day('2026-07-03', [['Squat', [[205, 5]]]]),
      day('2026-07-05', [['Squat', [[210, 5]]]]),
    ];
    expect(getTrend(days, 'Squat', '2026-07-06')).toBe('up');
  });

  it('is flat with fewer than two sessions', () => {
    expect(getTrend([day('2026-07-01', [['Squat', [[200, 5]]]])], 'Squat', '2026-07-02')).toBe('flat');
  });
});

describe('getExerciseHistory', () => {
  it('returns date-sorted points with max weight and total volume', () => {
    const days = [
      day('2026-07-03', [['Bench Press', [[155, 8]]]]),
      day('2026-07-01', [['Bench Press', [[135, 10], [145, 8]]]]),
    ];
    expect(getExerciseHistory(days, 'Bench Press')).toEqual([
      { date: '2026-07-01', maxWeight: 145, totalVolume: 135 * 10 + 145 * 8 },
      { date: '2026-07-03', maxWeight: 155, totalVolume: 155 * 8 },
    ]);
  });
});

describe('getPersonalRecords', () => {
  it('keeps the best weight per exercise, sorted descending, top 5', () => {
    const days = [
      day('2026-07-01', [
        ['Bench Press', [[135, 10]]],
        ['Squat', [[225, 5]]],
        ['Deadlift', [[315, 3]]],
        ['Row', [[95, 12]]],
        ['Curl', [[45, 10]]],
        ['Press', [[95, 8]]],
      ]),
      day('2026-07-03', [['Bench Press', [[185, 3]]]]),
    ];
    const records = getPersonalRecords(days);
    expect(records).toHaveLength(5);
    expect(records[0]).toEqual({ name: 'Deadlift', maxWeight: 315 });
    expect(records.find((r) => r.name === 'Bench Press')!.maxWeight).toBe(185);
  });
});

describe('getWorkoutStats', () => {
  it('counts days with exercises, unique names, and the best streak', () => {
    const days = [
      day('2026-07-01', [['A', [[10, 10]]]]),
      day('2026-07-02', [['B', [[10, 10]]]]),
      day('2026-07-03', [['a', [[10, 10]]]]), // same exercise as A
      day('2026-07-05', [['C', [[10, 10]]]]),
      day('2026-07-06', []), // no exercises — not a workout day
    ];
    expect(getWorkoutStats(days)).toEqual({ totalDays: 4, uniqueExercises: 3, bestStreak: 3 });
  });

  it('handles the empty case', () => {
    expect(getWorkoutStats([])).toEqual({ totalDays: 0, uniqueExercises: 0, bestStreak: 0 });
  });
});

describe('getLoggedExerciseNames', () => {
  it('dedupes case-insensitively keeping the first-seen casing', () => {
    const days = [
      day('2026-07-01', [['Bench Press', [[135, 10]]]]),
      day('2026-07-02', [['bench press', [[135, 10]]], ['Squat', [[200, 5]]]]),
    ];
    expect(getLoggedExerciseNames(days)).toEqual(['Bench Press', 'Squat']);
  });
});
