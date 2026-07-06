import { Router } from 'express';
import type { AppDeps } from '../app';
import { requireAuth, sessionUser } from '../authz';
import { parseDayRecord, parseName, ValidationError } from '../validate';
import type { DayRecord } from '../types';

/**
 * Export/import of a user's own data. Import accepts both this app's export
 * format and the old Workout Book localStorage payload:
 *   { wb_days: [...], wb_saved_workouts: [...], wb_settings: {...} }
 * The day shapes are identical, which is what makes migration a paste.
 */

interface ImportPayload {
  days?: unknown;
  savedWorkouts?: unknown;
  settings?: unknown;
  wb_days?: unknown;
  wb_saved_workouts?: unknown;
  wb_settings?: unknown;
}

export interface ImportResult {
  daysImported: number;
  daysSkipped: number;
  workoutsImported: number;
  workoutsSkipped: number;
}

export function importUserData(
  repo: AppDeps['repo'],
  userId: number,
  payload: ImportPayload
): ImportResult {
  const rawDays = payload.days ?? payload.wb_days;
  const rawWorkouts = payload.savedWorkouts ?? payload.wb_saved_workouts;
  const rawSettings = payload.settings ?? payload.wb_settings;

  const result: ImportResult = { daysImported: 0, daysSkipped: 0, workoutsImported: 0, workoutsSkipped: 0 };

  if (Array.isArray(rawDays)) {
    for (const raw of rawDays) {
      const date = (raw as { date?: unknown })?.date;
      let day: DayRecord;
      try {
        day = parseDayRecord(raw, typeof date === 'string' ? date : '');
      } catch {
        result.daysSkipped++;
        continue;
      }
      // Merge rule (SPEC §5.6): an imported day replaces a missing or empty
      // existing day; a day that already has exercises is left alone.
      const existing = repo.getDay(userId, day.date);
      if (existing && existing.exercises.length > 0) {
        result.daysSkipped++;
        continue;
      }
      repo.upsertDay(userId, day);
      result.daysImported++;
    }
  }

  if (Array.isArray(rawWorkouts)) {
    const existingNames = new Set(repo.listWorkouts(userId).map((w) => w.name.toLowerCase()));
    for (const raw of rawWorkouts) {
      const w = raw as { name?: unknown; exercises?: unknown };
      try {
        const name = parseName(w?.name, 'workout name');
        if (existingNames.has(name.toLowerCase()) || !Array.isArray(w.exercises) || w.exercises.length === 0) {
          result.workoutsSkipped++;
          continue;
        }
        const exercises = w.exercises.map((e) => parseName(e, 'exercise name'));
        repo.createWorkout(userId, name, exercises);
        existingNames.add(name.toLowerCase());
        result.workoutsImported++;
      } catch {
        result.workoutsSkipped++;
      }
    }
  }

  const unit = (rawSettings as { weightUnit?: unknown })?.weightUnit;
  if (unit === 'lb' || unit === 'kg') {
    repo.setSettings(userId, { ...repo.getSettings(userId), weightUnit: unit });
  }

  return result;
}

export function dataRoutes(deps: AppDeps): Router {
  const { repo } = deps;
  const router = Router();

  router.get('/api/export', requireAuth, (req, res) => {
    const user = sessionUser(req)!;
    res.setHeader('Content-Disposition', 'attachment; filename="rippy-rippy-export.json"');
    res.json({
      app: 'rippy-rippy',
      exportedAt: new Date().toISOString(),
      days: repo.listDays(user.userId),
      savedWorkouts: repo.listWorkouts(user.userId),
      settings: repo.getSettings(user.userId),
    });
  });

  router.post('/api/import', requireAuth, (req, res) => {
    const user = sessionUser(req)!;
    const payload = req.body as ImportPayload;
    if (!payload || typeof payload !== 'object') {
      res.status(400).json({ error: 'body must be a JSON object' });
      return;
    }
    if (!Array.isArray(payload.days ?? payload.wb_days) && !Array.isArray(payload.savedWorkouts ?? payload.wb_saved_workouts)) {
      res.status(400).json({ error: 'nothing to import — expected days or savedWorkouts arrays' });
      return;
    }
    try {
      res.json({ result: importUserData(repo, user.userId, payload) });
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  return router;
}
