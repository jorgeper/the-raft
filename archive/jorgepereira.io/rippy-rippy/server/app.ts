import express from 'express';
import path from 'path';
import fs from 'fs';
import cookieSession from 'cookie-session';
import type { Config } from './config';
import type { Repo } from './repo';
import { authRoutes, revalidateSession } from './routes/auth';
import { dayRoutes } from './routes/days';
import { workoutRoutes } from './routes/workouts';
import { settingsRoutes } from './routes/settings';
import { libraryRoutes } from './routes/library';
import { dataRoutes } from './routes/data';
import { devRoutes } from './routes/dev';

export interface AppDeps {
  config: Config;
  repo: Repo;
}

export function buildApp(deps: AppDeps): express.Express {
  const { config } = deps;
  const app = express();

  // In production the app sits behind a reverse proxy (Caddy) that
  // terminates HTTPS; trust its X-Forwarded-* headers.
  app.set('trust proxy', 1);

  // Avatars travel as small data URLs in JSON, so allow a couple of MB.
  app.use(express.json({ limit: '2mb' }));
  app.use(
    cookieSession({
      name: 'rippy.session',
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
  app.use(dayRoutes(deps));
  app.use(workoutRoutes(deps));
  app.use(settingsRoutes(deps));
  app.use(libraryRoutes(deps));
  app.use(dataRoutes(deps));
  app.use(devRoutes(deps));

  // Serve the built client (production). In dev, Vite serves the client and
  // proxies /api and /auth here — so only ever serve from a real dist/client.
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
