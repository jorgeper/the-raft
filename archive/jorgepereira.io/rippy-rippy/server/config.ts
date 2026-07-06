export interface Config {
  authMode: 'dev' | 'google';
  allowedEmails: string[];
  googleClientId: string;
  googleClientSecret: string;
  appOrigin: string;
  sessionSecret: string;
  databasePath: string;
  port: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const authMode = (env.AUTH_MODE ?? 'dev').toLowerCase();
  if (authMode !== 'dev' && authMode !== 'google') {
    throw new Error(`AUTH_MODE must be "dev" or "google", got "${env.AUTH_MODE}"`);
  }

  const allowedEmails = (env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowedEmails.length === 0) {
    throw new Error('ALLOWED_EMAILS must list at least one email (comma-separated)');
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

  const port = intInRange(env.PORT ?? '3001', 1, 65535, 'PORT');

  return {
    authMode,
    allowedEmails,
    googleClientId,
    googleClientSecret,
    appOrigin: env.APP_ORIGIN ?? `http://localhost:${port}`,
    sessionSecret,
    databasePath: env.DATABASE_PATH ?? './data/rippy.db',
    port,
  };
}

function intInRange(raw: string, min: number, max: number, name: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got "${raw}"`);
  }
  return n;
}
