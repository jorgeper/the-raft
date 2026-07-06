import { Router } from 'express';
import type { AppDeps } from '../app';
import { requireAuth, sessionUser } from '../authz';
import { isValidAvatar, parseName, ValidationError } from '../validate';

export function settingsRoutes(deps: AppDeps): Router {
  const { repo } = deps;
  const router = Router();

  router.get('/api/settings', requireAuth, (req, res) => {
    const user = sessionUser(req)!;
    res.json({ settings: repo.getSettings(user.userId) });
  });

  router.put('/api/settings', requireAuth, (req, res) => {
    const user = sessionUser(req)!;
    const { weightUnit, devMode } = (req.body ?? {}) as { weightUnit?: unknown; devMode?: unknown };
    if (weightUnit !== 'lb' && weightUnit !== 'kg') {
      res.status(400).json({ error: 'weightUnit must be "lb" or "kg"' });
      return;
    }
    if (typeof devMode !== 'boolean') {
      res.status(400).json({ error: 'devMode must be a boolean' });
      return;
    }
    const settings = { weightUnit: weightUnit as 'lb' | 'kg', devMode };
    repo.setSettings(user.userId, settings);
    res.json({ settings });
  });

  // What the settings screen needs: the custom avatar and the Google photo
  // separately (unlike /api/me, which resolves them into one).
  router.get('/api/profile', requireAuth, (req, res) => {
    const session = sessionUser(req)!;
    const user = repo.getUser(session.userId)!;
    res.json({
      profile: {
        email: user.email,
        name: user.name ?? user.email.split('@')[0],
        customAvatar: user.avatar,
        googlePicture: user.googlePicture,
      },
    });
  });

  // Profile: display name and avatar. `avatar: null` or `useGooglePhoto`
  // reverts to the Google account photo (the fallback in /api/me).
  router.put('/api/profile', requireAuth, (req, res) => {
    const session = sessionUser(req)!;
    const body = (req.body ?? {}) as { name?: unknown; avatar?: unknown; useGooglePhoto?: unknown };
    const patch: { name?: string; avatar?: string | null } = {};
    try {
      if (body.name !== undefined) {
        patch.name = parseName(body.name, 'name');
      }
      if (body.useGooglePhoto === true) {
        patch.avatar = null;
      } else if (body.avatar !== undefined) {
        if (!isValidAvatar(body.avatar)) {
          res.status(400).json({ error: 'avatar must be a small image data URL or null' });
          return;
        }
        patch.avatar = body.avatar;
      }
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
    const user = repo.updateUser(session.userId, patch);
    res.json({
      user: {
        email: user.email,
        name: user.name ?? user.email.split('@')[0],
        avatar: user.avatar ?? user.googlePicture,
        hasCustomAvatar: user.avatar !== null,
      },
    });
  });

  return router;
}
