import { loadConfig } from './config';
import { openDb } from './db';
import { SqliteRepo } from './sqliteRepo';
import { seedLibrary } from './library';
import { buildApp } from './app';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file — rely on real environment variables.
}

const config = loadConfig();
const db = openDb(config.databasePath);
const repo = new SqliteRepo(db);
seedLibrary(repo);
const app = buildApp({ config, repo });

app.listen(config.port, () => {
  console.log(`Rippy Rippy server listening on http://localhost:${config.port} (auth: ${config.authMode})`);
});
