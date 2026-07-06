import type { DayExercise, DayRecord, SetEntry, TimerState } from './types';

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MAX_NAME_LENGTH = 80;
const MAX_EXERCISES_PER_DAY = 50;
const MAX_SETS_PER_EXERCISE = 50;
const MAX_WEIGHT = 10_000;
const MAX_REPS = 1_000;

export class ValidationError extends Error {}

export function isValidDate(date: unknown): date is string {
  if (typeof date !== 'string' || !DATE_RE.test(date)) return false;
  // Reject impossible dates like 2026-02-31 (Date rolls them over).
  const d = new Date(date + 'T12:00:00');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

/** Trimmed, non-empty, capped name (exercise or workout). */
export function parseName(raw: unknown, what: string): string {
  if (typeof raw !== 'string') throw new ValidationError(`${what} must be a string`);
  const name = raw.trim();
  if (!name) throw new ValidationError(`${what} must not be empty`);
  if (name.length > MAX_NAME_LENGTH) {
    throw new ValidationError(`${what} must be at most ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

function parseSet(raw: unknown): SetEntry {
  const s = raw as Partial<SetEntry>;
  const weight = Number(s?.weight);
  const reps = Number(s?.reps);
  if (!Number.isFinite(weight) || weight < 0 || weight > MAX_WEIGHT) {
    throw new ValidationError(`set weight must be a number between 0 and ${MAX_WEIGHT}`);
  }
  if (!Number.isInteger(reps) || reps < 0 || reps > MAX_REPS) {
    throw new ValidationError(`set reps must be an integer between 0 and ${MAX_REPS}`);
  }
  return { weight, reps };
}

function parseExercise(raw: unknown): DayExercise {
  const e = raw as Partial<DayExercise>;
  const name = parseName(e?.exerciseName, 'exercise name');
  if (!Array.isArray(e?.sets)) throw new ValidationError('exercise sets must be an array');
  if (e.sets.length > MAX_SETS_PER_EXERCISE) {
    throw new ValidationError(`an exercise can have at most ${MAX_SETS_PER_EXERCISE} sets`);
  }
  const id = typeof e.id === 'string' && e.id.length <= 64 && e.id.length > 0 ? e.id : null;
  if (!id) throw new ValidationError('exercise id must be a short string');
  return { id, exerciseName: name, sets: e.sets.map(parseSet) };
}

const TIMER_STATES: TimerState[] = ['idle', 'running', 'stopped'];

function parseTimestamp(raw: unknown, what: string): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string' || Number.isNaN(new Date(raw).getTime())) {
    throw new ValidationError(`${what} must be an ISO timestamp or null`);
  }
  return raw;
}

/** Validate a full day record from the client. `date` comes from the URL. */
export function parseDayRecord(raw: unknown, date: string): DayRecord {
  if (!isValidDate(date)) throw new ValidationError('date must be YYYY-MM-DD');
  const body = raw as Partial<DayRecord>;
  if (!Array.isArray(body?.exercises)) throw new ValidationError('exercises must be an array');
  if (body.exercises.length > MAX_EXERCISES_PER_DAY) {
    throw new ValidationError(`a day can have at most ${MAX_EXERCISES_PER_DAY} exercises`);
  }
  const workoutName =
    body.workoutName === null || body.workoutName === undefined
      ? null
      : parseName(body.workoutName, 'workout name');
  const timerState = TIMER_STATES.includes(body.timerState as TimerState)
    ? (body.timerState as TimerState)
    : null;
  if (!timerState) throw new ValidationError('timerState must be idle, running, or stopped');
  const timerElapsedMs = Number(body.timerElapsedMs ?? 0);
  if (!Number.isFinite(timerElapsedMs) || timerElapsedMs < 0) {
    throw new ValidationError('timerElapsedMs must be a non-negative number');
  }
  return {
    date,
    workoutName,
    exercises: body.exercises.map(parseExercise),
    timerState,
    timerStartedAt: parseTimestamp(body.timerStartedAt, 'timerStartedAt'),
    timerElapsedMs,
    timerStoppedAt: parseTimestamp(body.timerStoppedAt, 'timerStoppedAt'),
  };
}

/** True for a small square-cropped image data URL (or null = no photo). */
export function isValidAvatar(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.startsWith('data:image/') && value.length <= 500_000);
}
