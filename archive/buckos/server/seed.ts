/**
 * Seed the database with demo kids and a week of varied history.
 * Run with: npm run seed
 */
import { loadConfig } from './config';
import { systemClock } from './clock';
import { openDb } from './db';
import { SqliteRepo } from './sqliteRepo';
import { ensureResets, RESET_NOTE } from './ledger';

try {
  process.loadEnvFile('.env');
} catch {
  // rely on real environment variables
}

const config = loadConfig();
const db = openDb(config.databasePath);
const repo = new SqliteRepo(db);

db.exec('DELETE FROM transactions; DELETE FROM kids;');

const now = systemClock.now();
const daysAgo = (n: number, hour = 17, minute = 0) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate() - n, hour, minute);

interface SeedKid {
  name: string;
  email: string;
  allowance: number;
  createdDaysAgo: number;
  events: Array<{ daysAgo: number; hour?: number; amount: number; note: string; by: string }>;
}

const parent1 = config.parentEmails[0];
const parent2 = config.parentEmails[1] ?? config.parentEmails[0];

const seedKids: SeedKid[] = [
  {
    name: 'Maya',
    email: 'maya.demo@gmail.com',
    allowance: 100,
    createdDaysAgo: 9,
    events: [
      { daysAgo: 8, hour: 18, amount: 10, note: 'Helped with dishes', by: parent1 },
      { daysAgo: 6, hour: 9, amount: -15, note: 'Hit his brother', by: parent2 },
      { daysAgo: 5, hour: 19, amount: 20, note: 'Great report card', by: parent1 },
      { daysAgo: 3, hour: 16, amount: -10, note: 'Left bike in the rain', by: parent2 },
      { daysAgo: 1, hour: 18, amount: 5, note: 'Set the table all week', by: parent1 },
    ],
  },
  {
    name: 'Leo',
    email: 'leo.demo@gmail.com',
    allowance: 100,
    createdDaysAgo: 9,
    events: [
      { daysAgo: 7, hour: 17, amount: -40, note: 'Broke the neighbor’s window', by: parent2 },
      { daysAgo: 6, hour: 10, amount: -80, note: 'Drew on the living room wall', by: parent1 },
      { daysAgo: 4, hour: 18, amount: 15, note: 'Apologized and cleaned it up', by: parent1 },
      { daysAgo: 2, hour: 8, amount: -60, note: 'Skipped school', by: parent2 },
      { daysAgo: 0, hour: 8, amount: -25, note: 'Refused to do homework', by: parent1 },
    ],
  },
  {
    name: 'Zoe',
    email: 'zoe.demo@gmail.com',
    allowance: 60,
    createdDaysAgo: 8,
    events: [
      { daysAgo: 7, hour: 18, amount: 12, note: 'Fed the cat every day', by: parent1 },
      { daysAgo: 5, hour: 17, amount: 8, note: 'Helped little brother with reading', by: parent2 },
      { daysAgo: 2, hour: 19, amount: -5, note: 'Bedtime tantrum', by: parent2 },
      { daysAgo: 0, hour: 9, amount: 10, note: 'Made breakfast for everyone', by: parent1 },
    ],
  },
];

for (const s of seedKids) {
  const createdAt = daysAgo(s.createdDaysAgo, 12).toISOString();
  const kid = repo.createKid({ name: s.name, email: s.email, weeklyAllowance: s.allowance, createdAt });
  repo.addTxn({
    kidId: kid.id,
    amount: s.allowance,
    note: RESET_NOTE(s.allowance),
    type: 'reset',
    actorEmail: null,
    createdAt,
  });
  for (const e of s.events) {
    repo.addTxn({
      kidId: kid.id,
      amount: e.amount,
      note: e.note,
      type: 'adjustment',
      actorEmail: e.by,
      createdAt: daysAgo(e.daysAgo, e.hour ?? 17).toISOString(),
    });
  }
  // Insert any weekly resets that fall inside the seeded window, exactly as
  // the app would have.
  ensureResets(repo, kid, systemClock, config);
  console.log(`Seeded ${s.name} <${s.email}> — balance ${repo.balance(kid.id)}`);
}

console.log('Done. Log in as a parent to see the demo family.');
