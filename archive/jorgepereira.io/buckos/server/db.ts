import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  weekly_allowance INTEGER NOT NULL DEFAULT 100,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  avatar TEXT,
  google_picture TEXT
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kid_id INTEGER NOT NULL REFERENCES kids(id),
  amount INTEGER NOT NULL,
  note TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('adjustment','reset')),
  actor_email TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_txns_kid_created ON transactions (kid_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
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
  // Migrations for databases created before a column existed.
  const kidCols = db.pragma("table_info('kids')") as Array<{ name: string }>;
  for (const col of ['avatar', 'google_picture']) {
    if (!kidCols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE kids ADD COLUMN ${col} TEXT`);
    }
  }
  return db;
}
