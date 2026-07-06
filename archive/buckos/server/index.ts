import { loadConfig } from './config';
import { systemClock } from './clock';
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
const app = buildApp({ config, repo, clock: systemClock });

app.listen(config.port, () => {
  console.log(`Buckos server listening on http://localhost:${config.port} (auth: ${config.authMode})`);
});
