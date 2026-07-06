import type { DayRecord, DaySummary, Library, SavedWorkout, User, UserSettings } from './types';

/**
 * Storage interface. Every method that touches user data takes the owning
 * user's id — routes must always pass the *session* user's id, which is what
 * keeps one user's data invisible to another.
 */
export interface Repo {
  // Users
  findUserByEmail(email: string): User | null;
  getUser(id: number): User | null;
  createUser(email: string): User;
  updateUser(
    id: number,
    patch: Partial<Pick<User, 'name' | 'avatar' | 'googlePicture'>>
  ): User;

  // Days
  getDay(userId: number, date: string): DayRecord | null;
  upsertDay(userId: number, day: DayRecord): void;
  listDaySummaries(userId: number, from?: string, to?: string): DaySummary[];
  listDays(userId: number): DayRecord[]; // all days, ordered by date

  // Saved workouts
  listWorkouts(userId: number): SavedWorkout[];
  getWorkout(userId: number, id: number): SavedWorkout | null;
  createWorkout(userId: number, name: string, exercises: string[]): SavedWorkout;
  updateWorkout(userId: number, id: number, name: string, exercises: string[]): SavedWorkout | null;
  deleteWorkout(userId: number, id: number): boolean;

  // Per-user settings
  getSettings(userId: number): UserSettings;
  setSettings(userId: number, settings: UserSettings): void;

  // Exercise library (global, read-only for users)
  getLibrary(): Library | null;
  setLibrary(library: Library): void;

  // Danger zone (dev mode): wipe one user's data, never anyone else's
  deleteUserData(userId: number): void;
}
