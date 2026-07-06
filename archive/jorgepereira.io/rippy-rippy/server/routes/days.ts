import { Router } from 'express';
import type { AppDeps } from '../app';
import { requireAuth, sessionUser } from '../authz';
import { isValidDate, parseDayRecord, ValidationError } from '../validate';
import {
  getExerciseHistory,
  getLastSession,
  getLoggedExerciseNames,
  getPersonalRecords,
  getTrend,
  getWorkoutStats,
} from '../stats';

export function dayRoutes(deps: AppDeps): Router {
  const { repo } = deps;
  const router = Router();

  // Summaries for the month calendar dots.
  router.get('/api/days', requireAuth, (req, res) => {
    const { from, to } = req.query as { from?: string; to?: string };
    if ((from && !isValidDate(from)) || (to && !isValidDate(to))) {
      res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
      return;
    }
    const user = sessionUser(req)!;
    res.json({ days: repo.listDaySummaries(user.userId, from, to) });
  });

  router.get('/api/days/:date', requireAuth, (req, res) => {
    const { date } = req.params;
    if (!isValidDate(date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return;
    }
    const user = sessionUser(req)!;
    const day = repo.getDay(user.userId, date);
    if (!day) {
      res.status(404).json({ error: 'no-day' });
      return;
    }
    res.json({ day });
  });

  router.put('/api/days/:date', requireAuth, (req, res) => {
    const user = sessionUser(req)!;
    try {
      const day = parseDayRecord(req.body, req.params.date);
      repo.upsertDay(user.userId, day);
      res.json({ day });
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  // Last session + trend for a set of exercise names, relative to a date.
  router.get('/api/exercise-stats', requireAuth, (req, res) => {
    const { date, names } = req.query as { date?: string; names?: string };
    if (!date || !isValidDate(date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return;
    }
    const user = sessionUser(req)!;
    const days = repo.listDays(user.userId);
    const wanted = (names ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    const stats: Record<string, { lastSession: ReturnType<typeof getLastSession>; trend: ReturnType<typeof getTrend> }> = {};
    for (const name of wanted) {
      stats[name] = {
        lastSession: getLastSession(days, name, date),
        trend: getTrend(days, name, date),
      };
    }
    res.json({ stats });
  });

  // Everything the add-exercise modal needs in one call: all known names
  // (library + logged history) with last weight and trend relative to `date`.
  router.get('/api/suggestions', requireAuth, (req, res) => {
    const { date } = req.query as { date?: string };
    if (!date || !isValidDate(date)) {
      res.status(400).json({ error: 'date must be YYYY-MM-DD' });
      return;
    }
    const user = sessionUser(req)!;
    const days = repo.listDays(user.userId);
    const library = repo.getLibrary();

    const names = new Map<string, { name: string; inLibrary: boolean }>();
    for (const ex of library?.exercises ?? []) {
      names.set(ex.name.toLowerCase(), { name: ex.name, inLibrary: true });
    }
    for (const name of getLoggedExerciseNames(days)) {
      if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), { name, inLibrary: false });
    }

    const suggestions = Array.from(names.values()).map(({ name, inLibrary }) => ({
      name,
      inLibrary,
      lastSession: getLastSession(days, name, date),
      trend: getTrend(days, name, date),
    }));
    res.json({ suggestions });
  });

  // Analytics: summary stats + PRs, and per-exercise history for charts.
  router.get('/api/analytics', requireAuth, (req, res) => {
    const user = sessionUser(req)!;
    const days = repo.listDays(user.userId);
    res.json({
      stats: getWorkoutStats(days),
      records: getPersonalRecords(days),
      exerciseNames: getLoggedExerciseNames(days).sort((a, b) => a.localeCompare(b)),
    });
  });

  router.get('/api/history', requireAuth, (req, res) => {
    const user = sessionUser(req)!;
    const days = repo.listDays(user.userId);
    const wanted = ((req.query.names as string) ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    const history: Record<string, ReturnType<typeof getExerciseHistory>> = {};
    for (const name of wanted) {
      history[name] = getExerciseHistory(days, name);
    }
    res.json({ history });
  });

  return router;
}
