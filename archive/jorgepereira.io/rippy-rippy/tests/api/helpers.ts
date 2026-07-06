import request from 'supertest';
import type { Express } from 'express';
import { openDb } from '../../server/db';
import { SqliteRepo } from '../../server/sqliteRepo';
import { loadConfig, type Config } from '../../server/config';
import { buildApp } from '../../server/app';
import type { Repo } from '../../server/repo';
import type { DayRecord } from '../../server/types';

export interface TestApp {
  app: Express;
  repo: Repo;
  config: Config;
}

export const JORGE = 'jorge@gmail.com';
export const FRIEND = 'friend@gmail.com';

export function makeTestApp(env: Partial<Record<string, string>> = {}): TestApp {
  const config = loadConfig({
    AUTH_MODE: 'dev',
    ALLOWED_EMAILS: `${JORGE},${FRIEND}`,
    SESSION_SECRET: 'test-secret',
    DATABASE_PATH: ':memory:',
    ...env,
  } as NodeJS.ProcessEnv);
  const repo = new SqliteRepo(openDb(':memory:'));
  const app = buildApp({ config, repo });
  return { app, repo, config };
}

/** A supertest agent already logged in as the given email (dev auth). */
export async function loginAs(app: Express, email: string) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/dev-login').send({ email });
  if (res.status !== 200) throw new Error(`dev-login failed for ${email}: ${res.status}`);
  return agent;
}

export function makeDay(date: string, overrides: Partial<DayRecord> = {}): DayRecord {
  return {
    date,
    workoutName: null,
    exercises: [
      {
        id: `ex-${date}`,
        exerciseName: 'Bench Press',
        sets: [
          { weight: 135, reps: 10 },
          { weight: 155, reps: 8 },
        ],
      },
    ],
    timerState: 'idle',
    timerStartedAt: null,
    timerElapsedMs: 0,
    timerStoppedAt: null,
    ...overrides,
  };
}
