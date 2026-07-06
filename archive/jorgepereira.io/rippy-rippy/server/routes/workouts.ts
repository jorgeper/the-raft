import { Router } from 'express';
import type { AppDeps } from '../app';
import { requireAuth, sessionUser } from '../authz';
import { parseName, ValidationError } from '../validate';

const MAX_EXERCISES = 50;

function parseWorkoutBody(body: unknown): { name: string; exercises: string[] } {
  const b = body as { name?: unknown; exercises?: unknown };
  const name = parseName(b?.name, 'workout name');
  if (!Array.isArray(b?.exercises) || b.exercises.length === 0) {
    throw new ValidationError('a workout needs at least one exercise');
  }
  if (b.exercises.length > MAX_EXERCISES) {
    throw new ValidationError(`a workout can have at most ${MAX_EXERCISES} exercises`);
  }
  return { name, exercises: b.exercises.map((e) => parseName(e, 'exercise name')) };
}

export function workoutRoutes(deps: AppDeps): Router {
  const { repo } = deps;
  const router = Router();

  router.get('/api/workouts', requireAuth, (req, res) => {
    const user = sessionUser(req)!;
    res.json({ workouts: repo.listWorkouts(user.userId) });
  });

  router.post('/api/workouts', requireAuth, (req, res) => {
    const user = sessionUser(req)!;
    try {
      const { name, exercises } = parseWorkoutBody(req.body);
      // Same name (case-insensitive) updates the existing workout — matches
      // the original app's "Save workout" semantics.
      const existing = repo
        .listWorkouts(user.userId)
        .find((w) => w.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        res.json({ workout: repo.updateWorkout(user.userId, existing.id, name, exercises) });
        return;
      }
      res.status(201).json({ workout: repo.createWorkout(user.userId, name, exercises) });
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.put('/api/workouts/:id', requireAuth, (req, res) => {
    const user = sessionUser(req)!;
    const id = Number(req.params.id);
    try {
      const { name, exercises } = parseWorkoutBody(req.body);
      const workout = repo.updateWorkout(user.userId, id, name, exercises);
      if (!workout) {
        res.status(404).json({ error: 'not-found' });
        return;
      }
      res.json({ workout });
    } catch (err) {
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }
  });

  router.delete('/api/workouts/:id', requireAuth, (req, res) => {
    const user = sessionUser(req)!;
    if (!repo.deleteWorkout(user.userId, Number(req.params.id))) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    res.status(204).end();
  });

  return router;
}
