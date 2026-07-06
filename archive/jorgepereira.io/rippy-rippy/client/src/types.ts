export interface SessionUser {
  email: string;
  name: string;
  avatar: string | null;
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

export interface DayRecord {
  date: string;
  workoutName: string | null;
  exercises: DayExercise[];
  timerState: TimerState;
  timerStartedAt: string | null;
  timerElapsedMs: number;
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
  exercises: string[];
}

export type WeightUnit = 'lb' | 'kg';

export interface UserSettings {
  weightUnit: WeightUnit;
  devMode: boolean;
}

export interface LastSession {
  weight: number;
  reps: number;
  maxWeight: number;
}

export type Trend = 'up' | 'down' | 'flat';

export interface ExerciseStat {
  lastSession: LastSession | null;
  trend: Trend;
}

export interface Suggestion {
  name: string;
  inLibrary: boolean;
  lastSession: LastSession | null;
  trend: Trend;
}

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

export interface DevUser {
  email: string;
  name: string;
  avatar: string | null;
}
