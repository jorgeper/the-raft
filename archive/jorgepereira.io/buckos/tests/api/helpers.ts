import { openDb } from '../../server/db';
import { SqliteRepo } from '../../server/sqliteRepo';
import { FixedClock } from '../../server/clock';
import { loadConfig, type Config } from '../../server/config';
import { buildApp } from '../../server/app';
import type { Express } from 'express';
import type { Repo } from '../../server/repo';

export interface TestApp {
  app: Express;
  repo: Repo;
  clock: FixedClock;
  config: Config;
}

export function makeTestApp(env: Partial<Record<string, string>> = {}): TestApp {
  const config = loadConfig({
    AUTH_MODE: 'dev',
    PARENT_EMAILS: 'mom@gmail.com,dad@gmail.com',
    SESSION_SECRET: 'test-secret',
    DATABASE_PATH: ':memory:',
    ...env,
  } as NodeJS.ProcessEnv);
  const repo = new SqliteRepo(openDb(':memory:'));
  const clock = new FixedClock();
  // Tue Jun 2 2026 10:00 local — a stable mid-week default for tests.
  clock.set(new Date(2026, 5, 2, 10));
  const app = buildApp({ config, repo, clock });
  return { app, repo, clock, config };
}
