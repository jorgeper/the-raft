import express from 'express';
import path from 'path';
import fs from 'fs';
import cookieSession from 'cookie-session';
import type { Config } from './config';
import type { Clock } from './clock';
import type { Repo } from './repo';
import { authRoutes, revalidateSession } from './routes/auth';
import { kidsRoutes } from './routes/kids';
import { kidViewRoutes } from './routes/kidView';
import { testClockRoutes } from './routes/testClock';
import { settingsRoutes } from './routes/settings';

export interface AppDeps {
  config: Config;
  repo: Repo;
  clock: Clock;
}

export function buildApp(deps: AppDeps): express.Express {
  const { config } = deps;
  const app = express();

  // Avatars travel as small data URLs in JSON, so allow a couple of MB.
  app.use(express.json({ limit: '2mb' }));
  app.use(
    cookieSession({
      name: 'buckos.session',
      secret: config.sessionSecret,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    })
  );

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use(revalidateSession(deps));
  app.use(authRoutes(deps));
  app.use(kidsRoutes(deps));
  app.use(kidViewRoutes(deps));
  app.use(settingsRoutes(deps));
  app.use(testClockRoutes(deps));

  // Serve the built client (production). In dev, Vite serves the client and
  // proxies /api and /auth here — so only ever serve from a real dist/client,
  // never the raw source tree (which __dirname/../client is under tsx).
  const clientDir = [path.resolve(__dirname, '../client'), path.resolve(process.cwd(), 'dist/client')].find(
    (dir) => dir.includes(path.join('dist', 'client')) && fs.existsSync(path.join(dir, 'index.html'))
  );
  if (clientDir) {
    app.use(express.static(clientDir));
    app.get(/^\/(?!api\/|auth\/).*/, (_req, res) => {
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  return app;
}
