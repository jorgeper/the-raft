import { Router } from 'express';
import type { AppDeps } from '../app';
import { requireKid, sessionUser } from '../authz';
import { chartData, ensureResets } from '../ledger';
import { isValidAvatar } from '../profiles';

export function kidViewRoutes(deps: AppDeps): Router {
  const { repo, clock, config } = deps;
  const router = Router();

  // Read-only view of the logged-in kid's own data. The kid id comes from the
  // session, never from the request, so a kid can only ever see themselves.
  router.get('/api/kid/summary', requireKid, (req, res) => {
    const user = sessionUser(req)!;
    const kid = repo.getKid(user.kidId!);
    if (!kid) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    ensureResets(repo, kid, clock, config);
    res.json({
      kid: { id: kid.id, name: kid.name, weeklyAllowance: kid.weeklyAllowance },
      balance: repo.balance(kid.id),
      chart: chartData(repo, kid.id, clock),
      transactions: repo.listTxns(kid.id),
    });
  });

  // The one thing a kid may change: their own profile picture. The kid id
  // comes from the session, so they can never touch another kid's profile.
  router.patch('/api/kid/profile', requireKid, (req, res) => {
    const user = sessionUser(req)!;
    const kid = repo.getKid(user.kidId!);
    if (!kid) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    if (!isValidAvatar(req.body?.avatar)) {
      res.status(400).json({ error: 'invalid-avatar' });
      return;
    }
    const updated = repo.updateKid(kid.id, { avatar: req.body.avatar });
    res.json({ avatar: updated.avatar });
  });

  return router;
}
