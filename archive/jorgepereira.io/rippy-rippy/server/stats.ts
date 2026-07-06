import type { DayRecord } from './types';

/**
 * Pure stats over a user's day records. All "last session" style lookups sort
 * by date and only consider days strictly BEFORE the reference date — the
 * original Workout Book walked days in insertion order and counted future
 * days, which corrupted history after out-of-order edits (SPEC §7 bug #1).
 */

export interface LastSession {
  weight: number; // first set's weight — the natural "working weight" seed
  reps: number;
  maxWeight: number;
}

export type Trend = 'up' | 'down' | 'flat';

export interface HistoryPoint {
  date: string;
  maxWeight: number;
  totalVolume: number;
}

export interface PersonalRecord {
  name: string;
  maxWeight: number;
}

export interface WorkoutStats {
  totalDays: number;
  uniqueExercises: number;
  bestStreak: number;
}

function sessionsBefore(days: DayRecord[], exerciseName: string, beforeDate: string): DayRecord[] {
  const name = exerciseName.trim().toLowerCase();
  return days
    .filter(
      (d) =>
        d.date < beforeDate &&
        d.exercises.some((e) => e.exerciseName.toLowerCase() === name && e.sets.length > 0)
    )
    .sort((a, b) => b.date.localeCompare(a.date)); // most recent first
}

function exerciseIn(day: DayRecord, exerciseName: string) {
  const name = exerciseName.trim().toLowerCase();
  return day.exercises.find((e) => e.exerciseName.toLowerCase() === name)!;
}

export function getLastSession(
  days: DayRecord[],
  exerciseName: string,
  beforeDate: string
): LastSession | null {
  const [latest] = sessionsBefore(days, exerciseName, beforeDate);
  if (!latest) return null;
  const ex = exerciseIn(latest, exerciseName);
  return {
    weight: ex.sets[0].weight,
    reps: ex.sets[0].reps,
    maxWeight: Math.max(...ex.sets.map((s) => s.weight)),
  };
}

/** Compare max weight across the last (up to) 3 sessions: newest vs oldest. */
export function getTrend(days: DayRecord[], exerciseName: string, beforeDate: string): Trend {
  const recent = sessionsBefore(days, exerciseName, beforeDate).slice(0, 3);
  if (recent.length < 2) return 'flat';
  const maxes = recent.map((d) => Math.max(...exerciseIn(d, exerciseName).sets.map((s) => s.weight)));
  const newest = maxes[0];
  const oldest = maxes[maxes.length - 1];
  if (newest > oldest) return 'up';
  if (newest < oldest) return 'down';
  return 'flat';
}

export function getExerciseHistory(days: DayRecord[], exerciseName: string): HistoryPoint[] {
  const name = exerciseName.trim().toLowerCase();
  return days
    .filter((d) => d.exercises.some((e) => e.exerciseName.toLowerCase() === name && e.sets.length > 0))
    .map((d) => {
      const ex = exerciseIn(d, exerciseName);
      return {
        date: d.date,
        maxWeight: Math.max(...ex.sets.map((s) => s.weight)),
        totalVolume: ex.sets.reduce((sum, s) => sum + s.weight * s.reps, 0),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getPersonalRecords(days: DayRecord[], limit = 5): PersonalRecord[] {
  const records = new Map<string, PersonalRecord>();
  for (const day of days) {
    for (const ex of day.exercises) {
      if (ex.sets.length === 0) continue;
      const maxWeight = Math.max(...ex.sets.map((s) => s.weight));
      const key = ex.exerciseName.toLowerCase();
      const existing = records.get(key);
      if (!existing || maxWeight > existing.maxWeight) {
        records.set(key, { name: ex.exerciseName, maxWeight });
      }
    }
  }
  return Array.from(records.values())
    .sort((a, b) => b.maxWeight - a.maxWeight)
    .slice(0, limit);
}

export function getWorkoutStats(days: DayRecord[]): WorkoutStats {
  const dates: string[] = [];
  const names = new Set<string>();
  for (const day of days) {
    if (day.exercises.length === 0) continue;
    dates.push(day.date);
    for (const ex of day.exercises) names.add(ex.exerciseName.toLowerCase());
  }
  dates.sort();

  let bestStreak = 0;
  let streak = 0;
  for (let i = 0; i < dates.length; i++) {
    if (i === 0) {
      streak = 1;
    } else {
      const prev = new Date(dates[i - 1] + 'T12:00:00').getTime();
      const curr = new Date(dates[i] + 'T12:00:00').getTime();
      const diffDays = Math.round((curr - prev) / 86_400_000);
      streak = diffDays === 1 ? streak + 1 : 1;
    }
    bestStreak = Math.max(bestStreak, streak);
  }

  return { totalDays: dates.length, uniqueExercises: names.size, bestStreak };
}

/** All exercise names a user has ever logged, deduped case-insensitively. */
export function getLoggedExerciseNames(days: DayRecord[]): string[] {
  const names = new Map<string, string>();
  for (const day of days) {
    for (const ex of day.exercises) {
      const key = ex.exerciseName.toLowerCase();
      if (!names.has(key)) names.set(key, ex.exerciseName);
    }
  }
  return Array.from(names.values());
}
