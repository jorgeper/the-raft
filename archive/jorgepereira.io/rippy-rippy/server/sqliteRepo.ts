import type { Database } from 'better-sqlite3';
import type { Repo } from './repo';
import type { DayRecord, DaySummary, Library, SavedWorkout, User, UserSettings } from './types';

interface UserRow {
  id: number;
  email: string;
  name: string | null;
  avatar: string | null;
  google_picture: string | null;
  created_at: string;
}

interface DayRow {
  date: string;
  workout_name: string | null;
  exercises: string;
  timer_state: DayRecord['timerState'];
  timer_started_at: string | null;
  timer_elapsed_ms: number;
  timer_stopped_at: string | null;
}

const LIBRARY_KEY = 'library';

function toUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatar: row.avatar,
    googlePicture: row.google_picture,
    createdAt: row.created_at,
  };
}

function toDay(row: DayRow): DayRecord {
  return {
    date: row.date,
    workoutName: row.workout_name,
    exercises: JSON.parse(row.exercises),
    timerState: row.timer_state,
    timerStartedAt: row.timer_started_at,
    timerElapsedMs: row.timer_elapsed_ms,
    timerStoppedAt: row.timer_stopped_at,
  };
}

export class SqliteRepo implements Repo {
  constructor(private db: Database) {}

  // --- Users ---

  findUserByEmail(email: string): User | null {
    const row = this.db
      .prepare('SELECT * FROM users WHERE email = ?')
      .get(email.trim().toLowerCase()) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  getUser(id: number): User | null {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? toUser(row) : null;
  }

  createUser(email: string): User {
    const info = this.db
      .prepare('INSERT INTO users (email, created_at) VALUES (?, ?)')
      .run(email.trim().toLowerCase(), new Date().toISOString());
    return this.getUser(Number(info.lastInsertRowid))!;
  }

  updateUser(id: number, patch: Partial<Pick<User, 'name' | 'avatar' | 'googlePicture'>>): User {
    const current = this.getUser(id);
    if (!current) throw new Error(`No user with id ${id}`);
    const next = { ...current, ...patch };
    this.db
      .prepare('UPDATE users SET name = ?, avatar = ?, google_picture = ? WHERE id = ?')
      .run(next.name, next.avatar, next.googlePicture, id);
    return this.getUser(id)!;
  }

  // --- Days ---

  getDay(userId: number, date: string): DayRecord | null {
    const row = this.db
      .prepare('SELECT * FROM days WHERE user_id = ? AND date = ?')
      .get(userId, date) as DayRow | undefined;
    return row ? toDay(row) : null;
  }

  upsertDay(userId: number, day: DayRecord): void {
    this.db
      .prepare(
        `INSERT INTO days (user_id, date, workout_name, exercises, timer_state, timer_started_at, timer_elapsed_ms, timer_stopped_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, date) DO UPDATE SET
           workout_name = excluded.workout_name,
           exercises = excluded.exercises,
           timer_state = excluded.timer_state,
           timer_started_at = excluded.timer_started_at,
           timer_elapsed_ms = excluded.timer_elapsed_ms,
           timer_stopped_at = excluded.timer_stopped_at`
      )
      .run(
        userId,
        day.date,
        day.workoutName,
        JSON.stringify(day.exercises),
        day.timerState,
        day.timerStartedAt,
        day.timerElapsedMs,
        day.timerStoppedAt
      );
  }

  listDaySummaries(userId: number, from?: string, to?: string): DaySummary[] {
    const rows = this.db
      .prepare(
        `SELECT date, workout_name, exercises FROM days
         WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date`
      )
      .all(userId, from ?? '0000-00-00', to ?? '9999-99-99') as Array<
      Pick<DayRow, 'date' | 'workout_name' | 'exercises'>
    >;
    return rows.map((r) => ({
      date: r.date,
      workoutName: r.workout_name,
      exerciseCount: (JSON.parse(r.exercises) as unknown[]).length,
    }));
  }

  listDays(userId: number): DayRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM days WHERE user_id = ? ORDER BY date')
      .all(userId) as DayRow[];
    return rows.map(toDay);
  }

  // --- Saved workouts ---

  listWorkouts(userId: number): SavedWorkout[] {
    const rows = this.db
      .prepare('SELECT id, name, exercises FROM saved_workouts WHERE user_id = ? ORDER BY id')
      .all(userId) as Array<{ id: number; name: string; exercises: string }>;
    return rows.map((r) => ({ id: r.id, name: r.name, exercises: JSON.parse(r.exercises) }));
  }

  getWorkout(userId: number, id: number): SavedWorkout | null {
    const row = this.db
      .prepare('SELECT id, name, exercises FROM saved_workouts WHERE user_id = ? AND id = ?')
      .get(userId, id) as { id: number; name: string; exercises: string } | undefined;
    return row ? { id: row.id, name: row.name, exercises: JSON.parse(row.exercises) } : null;
  }

  createWorkout(userId: number, name: string, exercises: string[]): SavedWorkout {
    const info = this.db
      .prepare('INSERT INTO saved_workouts (user_id, name, exercises, created_at) VALUES (?, ?, ?, ?)')
      .run(userId, name, JSON.stringify(exercises), new Date().toISOString());
    return { id: Number(info.lastInsertRowid), name, exercises };
  }

  updateWorkout(userId: number, id: number, name: string, exercises: string[]): SavedWorkout | null {
    const info = this.db
      .prepare('UPDATE saved_workouts SET name = ?, exercises = ? WHERE user_id = ? AND id = ?')
      .run(name, JSON.stringify(exercises), userId, id);
    return info.changes > 0 ? { id, name, exercises } : null;
  }

  deleteWorkout(userId: number, id: number): boolean {
    const info = this.db.prepare('DELETE FROM saved_workouts WHERE user_id = ? AND id = ?').run(userId, id);
    return info.changes > 0;
  }

  // --- Settings ---

  getSettings(userId: number): UserSettings {
    const row = this.db
      .prepare('SELECT weight_unit, dev_mode FROM user_settings WHERE user_id = ?')
      .get(userId) as { weight_unit: 'lb' | 'kg'; dev_mode: number } | undefined;
    return row
      ? { weightUnit: row.weight_unit, devMode: row.dev_mode === 1 }
      : { weightUnit: 'lb', devMode: false };
  }

  setSettings(userId: number, settings: UserSettings): void {
    this.db
      .prepare(
        `INSERT INTO user_settings (user_id, weight_unit, dev_mode) VALUES (?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET weight_unit = excluded.weight_unit, dev_mode = excluded.dev_mode`
      )
      .run(userId, settings.weightUnit, settings.devMode ? 1 : 0);
  }

  // --- Library ---

  getLibrary(): Library | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(LIBRARY_KEY) as
      | { value: string }
      | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as Library;
    } catch {
      return null;
    }
  }

  setLibrary(library: Library): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(LIBRARY_KEY, JSON.stringify(library));
  }

  // --- Danger zone ---

  deleteUserData(userId: number): void {
    const wipe = this.db.transaction(() => {
      this.db.prepare('DELETE FROM days WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM saved_workouts WHERE user_id = ?').run(userId);
      this.db.prepare('DELETE FROM user_settings WHERE user_id = ?').run(userId);
    });
    wipe();
  }
}
