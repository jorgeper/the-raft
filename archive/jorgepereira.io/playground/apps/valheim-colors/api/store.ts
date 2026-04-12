import Database from "better-sqlite3";
import crypto from "crypto";

let db: Database.Database;

export function initStore(): void {
  const dbPath = process.env.DB_PATH || "playground.db";
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS sheets (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      data        TEXT NOT NULL,
      share_token TEXT UNIQUE,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sheets_user ON sheets(user_id);
  `);
}

interface SheetRow {
  id: string;
  data: string;
  share_token: string | null;
  created_at: string;
  updated_at: string;
}

export function listSheets(userId: string): SheetRow[] {
  return db
    .prepare(
      "SELECT id, data, share_token, created_at, updated_at FROM sheets WHERE user_id = ? ORDER BY updated_at DESC"
    )
    .all(userId) as SheetRow[];
}

export function getSheet(userId: string, id: string): SheetRow | undefined {
  return db
    .prepare(
      "SELECT id, data, share_token, created_at, updated_at FROM sheets WHERE user_id = ? AND id = ?"
    )
    .get(userId, id) as SheetRow | undefined;
}

export function createSheet(userId: string, data: string): { id: string } {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO sheets (id, user_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, userId, data, now, now);
  return { id };
}

export function updateSheet(userId: string, id: string, data: string): boolean {
  const now = new Date().toISOString();
  const result = db
    .prepare("UPDATE sheets SET data = ?, updated_at = ? WHERE user_id = ? AND id = ?")
    .run(data, now, userId, id);
  return result.changes > 0;
}

export function deleteSheet(userId: string, id: string): boolean {
  const result = db
    .prepare("DELETE FROM sheets WHERE user_id = ? AND id = ?")
    .run(userId, id);
  return result.changes > 0;
}

export function shareSheet(userId: string, id: string): string | null {
  const existing = db
    .prepare("SELECT share_token FROM sheets WHERE user_id = ? AND id = ?")
    .get(userId, id) as { share_token: string | null } | undefined;
  if (existing?.share_token) return existing.share_token;

  const token = crypto.randomBytes(16).toString("base64url");
  const result = db
    .prepare("UPDATE sheets SET share_token = ? WHERE user_id = ? AND id = ?")
    .run(token, userId, id);
  return result.changes > 0 ? token : null;
}

export function unshareSheet(userId: string, id: string): boolean {
  const result = db
    .prepare("UPDATE sheets SET share_token = NULL WHERE user_id = ? AND id = ?")
    .run(userId, id);
  return result.changes > 0;
}

interface SharedRow {
  data: string;
  user_id: string;
}

export function getSharedSheet(token: string): SharedRow | undefined {
  return db
    .prepare("SELECT data, user_id FROM sheets WHERE share_token = ?")
    .get(token) as SharedRow | undefined;
}
