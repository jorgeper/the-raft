import { Router } from 'express';
import type { AppDeps } from '../app';
import { requireParent } from '../authz';

export const DEFAULT_ALLOWANCE_KEY = 'default_weekly_allowance';

export function defaultAllowance(repo: AppDeps['repo']): number {
  const raw = repo.getSetting(DEFAULT_ALLOWANCE_KEY);
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 100;
}

/** Family-wide settings. Parent only. */
export function settingsRoutes(deps: AppDeps): Router {
  const { repo } = deps;
  const router = Router();

  router.use('/api/settings', requireParent);

  router.get('/api/settings', (_req, res) => {
    res.json({ weeklyAllowance: defaultAllowance(repo) });
  });

  // Changing the weekly allowance applies to every kid and becomes the
  // default for new kids. A single kid can still be fine-tuned via Edit kid.
  router.patch('/api/settings', (req, res) => {
    const raw = req.body?.weeklyAllowance;
    const n = Number(raw);
    if (raw === null || raw === undefined || raw === '' || !Number.isInteger(n) || n < 0) {
      res.status(400).json({ error: 'invalid-allowance' });
      return;
    }
    repo.setSetting(DEFAULT_ALLOWANCE_KEY, String(n));
    for (const kid of repo.listKids()) {
      repo.updateKid(kid.id, { weeklyAllowance: n });
    }
    res.json({ weeklyAllowance: n });
  });

  return router;
}
