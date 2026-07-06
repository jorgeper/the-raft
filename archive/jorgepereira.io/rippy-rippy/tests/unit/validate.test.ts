import { describe, it, expect } from 'vitest';
import { isValidDate, parseDayRecord, parseName, isValidAvatar, ValidationError } from '../../server/validate';

const validDay = {
  workoutName: null,
  exercises: [{ id: 'e1', exerciseName: 'Bench Press', sets: [{ weight: 135, reps: 10 }] }],
  timerState: 'idle',
  timerStartedAt: null,
  timerElapsedMs: 0,
  timerStoppedAt: null,
};

describe('isValidDate', () => {
  it('accepts real dates and rejects malformed or impossible ones', () => {
    expect(isValidDate('2026-07-06')).toBe(true);
    expect(isValidDate('2026-7-6')).toBe(false);
    expect(isValidDate('2026-02-31')).toBe(false);
    expect(isValidDate('not-a-date')).toBe(false);
    expect(isValidDate(20260706)).toBe(false);
  });
});

describe('parseName', () => {
  it('trims and enforces the length cap', () => {
    expect(parseName('  Bench Press  ', 'exercise name')).toBe('Bench Press');
    expect(() => parseName('', 'exercise name')).toThrow(ValidationError);
    expect(() => parseName('   ', 'exercise name')).toThrow(ValidationError);
    expect(() => parseName('x'.repeat(81), 'exercise name')).toThrow(ValidationError);
    expect(() => parseName(42, 'exercise name')).toThrow(ValidationError);
  });
});

describe('parseDayRecord', () => {
  it('accepts a valid record and preserves decimals', () => {
    const day = parseDayRecord(
      { ...validDay, exercises: [{ id: 'e1', exerciseName: 'Curl', sets: [{ weight: 27.5, reps: 12 }] }] },
      '2026-07-06'
    );
    expect(day.exercises[0].sets[0].weight).toBe(27.5);
  });

  it('rejects bad dates, weights, reps, and timer states', () => {
    expect(() => parseDayRecord(validDay, '2026-13-99')).toThrow(ValidationError);
    expect(() =>
      parseDayRecord(
        { ...validDay, exercises: [{ id: 'e', exerciseName: 'X', sets: [{ weight: -5, reps: 1 }] }] },
        '2026-07-06'
      )
    ).toThrow(ValidationError);
    expect(() =>
      parseDayRecord(
        { ...validDay, exercises: [{ id: 'e', exerciseName: 'X', sets: [{ weight: 5, reps: 2.5 }] }] },
        '2026-07-06'
      )
    ).toThrow(ValidationError);
    expect(() => parseDayRecord({ ...validDay, timerState: 'paused' }, '2026-07-06')).toThrow(ValidationError);
    expect(() => parseDayRecord({ ...validDay, timerElapsedMs: -1 }, '2026-07-06')).toThrow(ValidationError);
  });

  it('rejects oversized payloads', () => {
    const manyExercises = Array.from({ length: 51 }, (_, i) => ({
      id: `e${i}`,
      exerciseName: `X${i}`,
      sets: [],
    }));
    expect(() => parseDayRecord({ ...validDay, exercises: manyExercises }, '2026-07-06')).toThrow(
      ValidationError
    );
  });
});

describe('isValidAvatar', () => {
  it('accepts null and small image data URLs only', () => {
    expect(isValidAvatar(null)).toBe(true);
    expect(isValidAvatar('data:image/png;base64,abc')).toBe(true);
    expect(isValidAvatar('https://example.com/x.png')).toBe(false);
    expect(isValidAvatar('data:image/png;base64,' + 'a'.repeat(600_000))).toBe(false);
  });
});
