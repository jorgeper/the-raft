export interface SessionUser {
  userId: number;
  email: string;
}

export interface SetEntry {
  weight: number;
  reps: number;
}

export interface DayExercise {
  id: string;
  exerciseName: string;
  sets: SetEntry[];
}

export type TimerState = 'idle' | 'running' | 'stopped';

/** One day of the training book — the unit the client edits and syncs. */
export interface DayRecord {
  date: string; // YYYY-MM-DD
  workoutName: string | null;
  exercises: DayExercise[];
  timerState: TimerState;
  timerStartedAt: string | null; // ISO timestamp while running
  timerElapsedMs: number; // accumulated across start/stop cycles
  timerStoppedAt: string | null;
}

export interface DaySummary {
  date: string;
  workoutName: string | null;
  exerciseCount: number;
}

export interface SavedWorkout {
  id: number;
  name: string;
  exercises: string[]; // ordered exercise names
}

export type WeightUnit = 'lb' | 'kg';

export interface UserSettings {
  weightUnit: WeightUnit;
  devMode: boolean;
}

export interface User {
  id: number;
  email: string;
  name: string | null;
  avatar: string | null; // app-set photo (data URL) — always wins
  googlePicture: string | null; // Google account photo, refreshed at sign-in
  createdAt: string;
}

export interface LibraryExercise {
  name: string;
  description?: string;
  movementPattern?: string;
  muscleGroup?: string;
  exerciseType?: string;
  equipment?: string;
  calisthenics?: boolean;
  alternatives?: string[];
}

export interface Library {
  version: string;
  exercises: LibraryExercise[];
}
