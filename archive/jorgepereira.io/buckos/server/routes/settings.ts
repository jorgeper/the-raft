import { Router } from 'express';
import type { AppDeps } from '../app';
import { requireParent, sessionUser } from '../authz';
import { getProfile, isValidAvatar, setProfile } from '../profiles';

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

  // The logged-in parent's own profile (display name + photo).
  router.use('/api/profile', requireParent);

  router.get('/api/profile', (req, res) => {
    res.json(getProfile(repo, sessionUser(req)!.email));
  });

  router.patch('/api/profile', (req, res) => {
    const email = sessionUser(req)!.email;
    const current = getProfile(repo, email);
    const next = { ...current };

    if (req.body?.name !== undefined) {
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!name || name.length > 60) {
        res.status(400).json({ error: 'invalid-name' });
        return;
      }
      next.name = name;
    }
    if (req.body?.avatar !== undefined) {
      if (!isValidAvatar(req.body.avatar)) {
        res.status(400).json({ error: 'invalid-avatar' });
        return;
      }
      next.avatar = req.body.avatar;
    }

    setProfile(repo, email, next);
    res.json(next);
  });

  return router;
}
