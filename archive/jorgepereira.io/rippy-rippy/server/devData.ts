import type { DayExercise, DayRecord, WeightUnit } from './types';

/**
 * Dev-mode test data generation, ported from the original Workout Book.
 * Produces realistic push/pull/legs days with progressing weights.
 */

interface GenExercise {
  name: string;
  category: 'chest' | 'back' | 'shoulders' | 'legs' | 'arms' | 'core';
  weightRange: { min: number; max: number };
}

const GEN_LIBRARY: GenExercise[] = [
  // Chest
  { name: 'Bench Press', category: 'chest', weightRange: { min: 95, max: 315 } },
  { name: 'Incline Bench Press', category: 'chest', weightRange: { min: 75, max: 255 } },
  { name: 'Dumbbell Bench Press', category: 'chest', weightRange: { min: 30, max: 120 } },
  { name: 'Incline Dumbbell Press', category: 'chest', weightRange: { min: 25, max: 100 } },
  { name: 'Cable Fly', category: 'chest', weightRange: { min: 15, max: 60 } },
  { name: 'Machine Chest Press', category: 'chest', weightRange: { min: 50, max: 250 } },
  // Back
  { name: 'Barbell Row', category: 'back', weightRange: { min: 95, max: 275 } },
  { name: 'Deadlift', category: 'back', weightRange: { min: 135, max: 495 } },
  { name: 'Pull-Up', category: 'back', weightRange: { min: 0, max: 90 } },
  { name: 'Lat Pulldown', category: 'back', weightRange: { min: 60, max: 220 } },
  { name: 'Seated Cable Row', category: 'back', weightRange: { min: 60, max: 200 } },
  { name: 'Dumbbell Row', category: 'back', weightRange: { min: 30, max: 120 } },
  { name: 'Face Pull', category: 'back', weightRange: { min: 20, max: 70 } },
  // Shoulders
  { name: 'Overhead Press', category: 'shoulders', weightRange: { min: 65, max: 185 } },
  { name: 'Dumbbell Shoulder Press', category: 'shoulders', weightRange: { min: 25, max: 90 } },
  { name: 'Lateral Raise', category: 'shoulders', weightRange: { min: 10, max: 40 } },
  { name: 'Arnold Press', category: 'shoulders', weightRange: { min: 20, max: 70 } },
  // Legs
  { name: 'Squat', category: 'legs', weightRange: { min: 95, max: 405 } },
  { name: 'Front Squat', category: 'legs', weightRange: { min: 75, max: 315 } },
  { name: 'Leg Press', category: 'legs', weightRange: { min: 180, max: 800 } },
  { name: 'Romanian Deadlift', category: 'legs', weightRange: { min: 95, max: 315 } },
  { name: 'Leg Curl', category: 'legs', weightRange: { min: 40, max: 160 } },
  { name: 'Leg Extension', category: 'legs', weightRange: { min: 40, max: 180 } },
  { name: 'Calf Raise', category: 'legs', weightRange: { min: 50, max: 300 } },
  { name: 'Hip Thrust', category: 'legs', weightRange: { min: 95, max: 365 } },
  // Arms
  { name: 'Barbell Curl', category: 'arms', weightRange: { min: 30, max: 120 } },
  { name: 'Dumbbell Curl', category: 'arms', weightRange: { min: 15, max: 55 } },
  { name: 'Hammer Curl', category: 'arms', weightRange: { min: 15, max: 55 } },
  { name: 'Tricep Pushdown', category: 'arms', weightRange: { min: 30, max: 100 } },
  { name: 'Skull Crusher', category: 'arms', weightRange: { min: 30, max: 100 } },
  // Core
  { name: 'Cable Crunch', category: 'core', weightRange: { min: 40, max: 150 } },
  { name: 'Hanging Leg Raise', category: 'core', weightRange: { min: 0, max: 25 } },
  { name: 'Russian Twist', category: 'core', weightRange: { min: 10, max: 50 } },
];

export const DEV_WORKOUT_TEMPLATES: Array<{ name: string; exercises: string[] }> = [
  { name: 'Push Day', exercises: ['Bench Press', 'Incline Dumbbell Press', 'Overhead Press', 'Lateral Raise', 'Tricep Pushdown', 'Cable Fly'] },
  { name: 'Pull Day', exercises: ['Deadlift', 'Barbell Row', 'Lat Pulldown', 'Face Pull', 'Barbell Curl', 'Hammer Curl'] },
  { name: 'Leg Day', exercises: ['Squat', 'Romanian Deadlift', 'Leg Press', 'Leg Curl', 'Leg Extension', 'Calf Raise'] },
  { name: 'Upper Body', exercises: ['Bench Press', 'Barbell Row', 'Dumbbell Shoulder Press', 'Lat Pulldown', 'Dumbbell Curl', 'Tricep Pushdown'] },
  { name: 'Lower Body', exercises: ['Squat', 'Hip Thrust', 'Leg Curl', 'Calf Raise', 'Leg Extension'] },
  { name: 'Full Body', exercises: ['Squat', 'Bench Press', 'Barbell Row', 'Overhead Press', 'Romanian Deadlift', 'Pull-Up'] },
];

function toDateStr(d: Date): string {
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

let genCounter = 0;
function genId(): string {
  return `gen-${Date.now().toString(36)}-${(genCounter++).toString(36)}`;
}

export function generateTestDays(startDate: string, numDays: number, unit: WeightUnit): DayRecord[] {
  const splits = [
    { name: 'Push', categories: ['chest', 'shoulders', 'arms'] },
    { name: 'Pull', categories: ['back', 'arms'] },
    { name: 'Legs', categories: ['legs', 'core'] },
  ];
  const isKg = unit === 'kg';
  const roundTo = isKg ? 2.5 : 5;
  const roundWeight = (w: number) => Math.round(w / roundTo) * roundTo;
  const pickRandom = <T>(arr: T[], count: number): T[] =>
    arr
      .slice()
      .sort(() => Math.random() - 0.5)
      .slice(0, count);

  const start = new Date(startDate + 'T12:00:00');
  const days: DayRecord[] = [];
  let splitIdx = 0;

  for (let i = 0; i < numDays; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);

    if (Math.random() < 0.3) continue; // rest day

    const split = splits[splitIdx % splits.length];
    splitIdx++;

    const pool = GEN_LIBRARY.filter((e) => split.categories.includes(e.category));
    const chosen = pickRandom(pool, 5 + Math.floor(Math.random() * 2));
    const progress = numDays > 1 ? i / (numDays - 1) : 0.5;

    const exercises: DayExercise[] = chosen.map((ex) => {
      const numSets = 3 + Math.floor(Math.random() * 2);
      const { min, max } = ex.weightRange;
      const lowPct = 0.4 + progress * 0.2;
      const highPct = 0.6 + progress * 0.25;
      const basePct = lowPct + Math.random() * (highPct - lowPct);
      let baseWeight = min + (max - min) * basePct;
      if (isKg) baseWeight = baseWeight * 0.453592;
      baseWeight = roundWeight(baseWeight);
      if (baseWeight <= 0 && max > 0) baseWeight = roundTo;

      const sets = [];
      for (let s = 0; s < numSets; s++) {
        const reps = Math.max(6, Math.round(12 - s * 1.5 + (Math.random() * 2 - 1)));
        sets.push({ weight: baseWeight, reps });
      }
      return { id: genId(), exerciseName: ex.name, sets };
    });

    const durationMs = (30 + Math.floor(Math.random() * 46)) * 60 * 1000;
    days.push({
      date: toDateStr(d),
      workoutName: split.name + ' Day',
      exercises,
      timerState: 'stopped',
      timerStartedAt: null,
      timerElapsedMs: durationMs,
      timerStoppedAt: new Date(d.getTime() + durationMs).toISOString(),
    });
  }

  return days;
}
