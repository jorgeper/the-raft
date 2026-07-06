import { Router } from 'express';
import type { AppDeps } from '../app';
import { FixedClock } from '../clock';

/**
 * Test-only time control, used by the e2e suite to cross weekly-reset
 * boundaries. Only mounted when ENABLE_TEST_CLOCK=1 and the app was built
 * with a FixedClock. Never enable in production.
 */
export function testClockRoutes(deps: AppDeps): Router {
  const router = Router();
  const clock = deps.clock;
  if (!deps.config.enableTestClock || !(clock instanceof FixedClock)) return router;

  router.post('/api/test/clock', (req, res) => {
    const time = new Date(String(req.body?.time ?? ''));
    if (Number.isNaN(time.getTime())) {
      res.status(400).json({ error: 'invalid-time' });
      return;
    }
    clock.set(time);
    res.json({ now: clock.now().toISOString() });
  });

  router.delete('/api/test/clock', (_req, res) => {
    clock.clear();
    res.json({ now: clock.now().toISOString() });
  });

  return router;
}
