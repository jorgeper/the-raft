import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  avatar TEXT,
  google_picture TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS days (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  workout_name TEXT,
  exercises TEXT NOT NULL DEFAULT '[]',
  timer_state TEXT NOT NULL DEFAULT 'idle' CHECK (timer_state IN ('idle','running','stopped')),
  timer_started_at TEXT,
  timer_elapsed_ms INTEGER NOT NULL DEFAULT 0,
  timer_stopped_at TEXT,
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_days_user_date ON days (user_id, date);

CREATE TABLE IF NOT EXISTS saved_workouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  exercises TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workouts_user ON saved_workouts (user_id);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  weight_unit TEXT NOT NULL DEFAULT 'lb' CHECK (weight_unit IN ('lb','kg')),
  dev_mode INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(databasePath: string): Database.Database {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
