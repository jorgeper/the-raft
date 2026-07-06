/**
 * Dev seed: wipes the local database and fills it with a month of realistic
 * history for the first allowed user, plus the sample saved workouts.
 * Usage: npm run seed
 */
import fs from 'fs';
import { loadConfig } from './config';
import { openDb } from './db';
import { SqliteRepo } from './sqliteRepo';
import { seedLibrary } from './library';
import { DEV_WORKOUT_TEMPLATES, generateTestDays } from './devData';

try {
  process.loadEnvFile('.env');
} catch {
  // fall through to defaults below
}

process.env.AUTH_MODE ??= 'dev';
process.env.ALLOWED_EMAILS ??= 'jorgeper@gmail.com,friend@gmail.com';
process.env.SESSION_SECRET ??= 'dev-secret';

const config = loadConfig();
if (fs.existsSync(config.databasePath)) fs.rmSync(config.databasePath);
const repo = new SqliteRepo(openDb(config.databasePath));
seedLibrary(repo);

const user = repo.createUser(config.allowedEmails[0]);
repo.setSettings(user.id, { weightUnit: 'lb', devMode: true });

const start = new Date();
start.setDate(start.getDate() - 30);
const startStr =
  start.getFullYear() +
  '-' +
  String(start.getMonth() + 1).padStart(2, '0') +
  '-' +
  String(start.getDate()).padStart(2, '0');

const days = generateTestDays(startStr, 30, 'lb');
for (const day of days) repo.upsertDay(user.id, day);
for (const tpl of DEV_WORKOUT_TEMPLATES) repo.createWorkout(user.id, tpl.name, [...tpl.exercises]);

console.log(
  `Seeded ${config.databasePath}: user ${user.email}, ${days.length} workout days, ${DEV_WORKOUT_TEMPLATES.length} saved workouts.`
);
