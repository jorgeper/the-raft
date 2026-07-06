import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { AppDeps } from '../app';
import { requireAuth, sessionUser } from '../authz';
import { isValidDate } from '../validate';
import { DEV_WORKOUT_TEMPLATES, generateTestDays } from '../devData';

export function devRoutes(deps: AppDeps): Router {
  const { repo } = deps;
  const router = Router();

  // Dev tools only work for users who flipped Developer Mode on in Settings,
  // and only ever touch the current user's own data.
  function requireDevMode(req: Request, res: Response, next: NextFunction): void {
    const user = sessionUser(req)!;
    if (!repo.getSettings(user.userId).devMode) {
      res.status(403).json({ error: 'dev-mode-off' });
      return;
    }
    next();
  }

  router.post('/api/dev/generate-days', requireAuth, requireDevMode, (req, res) => {
    const user = sessionUser(req)!;
    const { startDate, count } = (req.body ?? {}) as { startDate?: unknown; count?: unknown };
    if (typeof startDate !== 'string' || !isValidDate(startDate)) {
      res.status(400).json({ error: 'startDate must be YYYY-MM-DD' });
      return;
    }
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 90) {
      res.status(400).json({ error: 'count must be an integer between 1 and 90' });
      return;
    }
    const unit = repo.getSettings(user.userId).weightUnit;
    const days = generateTestDays(startDate, n, unit);
    for (const day of days) repo.upsertDay(user.userId, day);
    res.json({ generated: days.length });
  });

  router.post('/api/dev/generate-workouts', requireAuth, requireDevMode, (req, res) => {
    const user = sessionUser(req)!;
    const existing = new Set(repo.listWorkouts(user.userId).map((w) => w.name.toLowerCase()));
    let added = 0;
    for (const tpl of DEV_WORKOUT_TEMPLATES) {
      if (!existing.has(tpl.name.toLowerCase())) {
        repo.createWorkout(user.userId, tpl.name, [...tpl.exercises]);
        added++;
      }
    }
    res.json({ added });
  });

  router.post('/api/dev/reset', requireAuth, requireDevMode, (req, res) => {
    const user = sessionUser(req)!;
    repo.deleteUserData(user.userId);
    res.status(204).end();
  });

  return router;
}
