import { loadConfig } from './config';
import { FixedClock, systemClock } from './clock';
import { openDb } from './db';
import { SqliteRepo } from './sqliteRepo';
import { buildApp } from './app';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file — rely on real environment variables.
}

const config = loadConfig();
const db = openDb(config.databasePath);
const repo = new SqliteRepo(db);
// A FixedClock (falls back to real time until set) is only used when the
// test-clock endpoint is enabled, so e2e tests can control time.
const clock = config.enableTestClock ? new FixedClock() : systemClock;
const app = buildApp({ config, repo, clock });

app.listen(config.port, () => {
  console.log(`Buckos server listening on http://localhost:${config.port} (auth: ${config.authMode})`);
});
