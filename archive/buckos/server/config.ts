export interface Config {
  authMode: 'dev' | 'google';
  parentEmails: string[];
  googleClientId: string;
  googleClientSecret: string;
  appOrigin: string;
  sessionSecret: string;
  databasePath: string;
  resetDay: number; // 0=Sunday .. 6=Saturday
  resetHour: number; // 0-23
  port: number;
  enableTestClock: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const authMode = (env.AUTH_MODE ?? 'dev').toLowerCase();
  if (authMode !== 'dev' && authMode !== 'google') {
    throw new Error(`AUTH_MODE must be "dev" or "google", got "${env.AUTH_MODE}"`);
  }

  const parentEmails = (env.PARENT_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (parentEmails.length === 0) {
    throw new Error('PARENT_EMAILS must list at least one parent email (comma-separated)');
  }

  const sessionSecret = env.SESSION_SECRET ?? '';
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET is required (generate one with: openssl rand -hex 32)');
  }

  const googleClientId = env.GOOGLE_CLIENT_ID ?? '';
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET ?? '';
  if (authMode === 'google' && (!googleClientId || !googleClientSecret)) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required when AUTH_MODE=google');
  }

  const resetDay = intInRange(env.RESET_DAY ?? '1', 0, 6, 'RESET_DAY');
  const resetHour = intInRange(env.RESET_HOUR ?? '0', 0, 23, 'RESET_HOUR');
  const port = intInRange(env.PORT ?? '3000', 1, 65535, 'PORT');

  return {
    authMode,
    parentEmails,
    googleClientId,
    googleClientSecret,
    appOrigin: env.APP_ORIGIN ?? `http://localhost:${port}`,
    sessionSecret,
    databasePath: env.DATABASE_PATH ?? './data/buckos.db',
    resetDay,
    resetHour,
    port,
    enableTestClock: env.ENABLE_TEST_CLOCK === '1',
  };
}

function intInRange(raw: string, min: number, max: number, name: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return n;
}
