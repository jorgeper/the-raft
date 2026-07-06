import { Router } from 'express';
import type { AppDeps } from '../app';
import { requireAuth } from '../authz';

export function libraryRoutes(deps: AppDeps): Router {
  const { repo } = deps;
  const router = Router();

  router.get('/api/library', requireAuth, (_req, res) => {
    const library = repo.getLibrary();
    res.json({ library: library ?? { version: '0', exercises: [] } });
  });

  return router;
}
