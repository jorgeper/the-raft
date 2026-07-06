import { describe, it, expect } from 'vitest';
import { makeTestApp, loginAs, makeDay, JORGE } from './helpers';

const WB_DAY = {
  id: 'old-uuid-1',
  date: '2026-06-01',
  workoutName: 'Push Day',
  exercises: [{ id: 'old-ex-1', exerciseName: 'Bench Press', sets: [{ weight: 185, reps: 5 }] }],
  timerState: 'stopped',
  timerStartedAt: null,
  timerElapsedMs: 3_600_000,
  timerStoppedAt: '2026-06-01T18:00:00.000Z',
};

describe('export/import API', () => {
  it('exports everything the user owns', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    await jorge.put('/api/days/2026-07-01').send(makeDay('2026-07-01'));
    await jorge.post('/api/workouts').send({ name: 'Push', exercises: ['Bench Press'] });
    await jorge.put('/api/settings').send({ weightUnit: 'kg', devMode: false });

    const res = await jorge.get('/api/export');
    expect(res.status).toBe(200);
    expect(res.body.app).toBe('rippy-rippy');
    expect(res.body.days).toHaveLength(1);
    expect(res.body.savedWorkouts).toHaveLength(1);
    expect(res.body.settings.weightUnit).toBe('kg');
  });

  it('imports the old Workout Book localStorage payload', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    const res = await jorge.post('/api/import').send({
      wb_days: [WB_DAY],
      wb_saved_workouts: [{ id: 'w1', name: 'Push Day', exercises: ['Bench Press', 'Cable Fly'] }],
      wb_settings: { weightUnit: 'kg', theme: 'dark', devMode: true },
    });
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({
      daysImported: 1,
      daysSkipped: 0,
      workoutsImported: 1,
      workoutsSkipped: 0,
    });

    const day = await jorge.get('/api/days/2026-06-01');
    expect(day.body.day.workoutName).toBe('Push Day');
    expect(day.body.day.timerElapsedMs).toBe(3_600_000);
    expect((await jorge.get('/api/settings')).body.settings.weightUnit).toBe('kg');
    // The old theme/devMode settings are not imported.
    expect((await jorge.get('/api/settings')).body.settings.devMode).toBe(false);
  });

  it('round-trips its own export format', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    await jorge.put('/api/days/2026-07-01').send(makeDay('2026-07-01'));
    await jorge.post('/api/workouts').send({ name: 'Push', exercises: ['Bench Press'] });
    const exported = (await jorge.get('/api/export')).body;

    await jorge.post('/api/dev/reset'); // wipe (needs dev mode)
    await jorge.put('/api/settings').send({ weightUnit: 'lb', devMode: true });
    await jorge.post('/api/dev/reset');

    const res = await jorge.post('/api/import').send(exported);
    expect(res.body.result.daysImported).toBe(1);
    expect(res.body.result.workoutsImported).toBe(1);
    expect((await jorge.get('/api/days/2026-07-01')).status).toBe(200);
  });

  it('never overwrites a day that already has exercises, and skips invalid days', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    await jorge.put('/api/days/2026-06-01').send(
      makeDay('2026-06-01', {
        exercises: [{ id: 'mine', exerciseName: 'Squat', sets: [{ weight: 225, reps: 5 }] }],
      })
    );

    const res = await jorge.post('/api/import').send({
      days: [WB_DAY, { date: 'garbage', exercises: [] }],
    });
    expect(res.body.result.daysImported).toBe(0);
    expect(res.body.result.daysSkipped).toBe(2);
    const day = await jorge.get('/api/days/2026-06-01');
    expect(day.body.day.exercises[0].exerciseName).toBe('Squat');
  });

  it('skips duplicate workout names on import', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    await jorge.post('/api/workouts').send({ name: 'Push Day', exercises: ['Bench Press'] });
    const res = await jorge.post('/api/import').send({
      savedWorkouts: [
        { name: 'push day', exercises: ['Cable Fly'] },
        { name: 'Leg Day', exercises: ['Squat'] },
      ],
    });
    expect(res.body.result).toMatchObject({ workoutsImported: 1, workoutsSkipped: 1 });
    expect((await jorge.get('/api/workouts')).body.workouts).toHaveLength(2);
  });

  it('rejects payloads with nothing to import', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    expect((await jorge.post('/api/import').send({ hello: 'world' })).status).toBe(400);
  });
});

describe('dev generators', () => {
  it('generates days and sample workouts for the current user', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    await jorge.put('/api/settings').send({ weightUnit: 'lb', devMode: true });

    const gen = await jorge.post('/api/dev/generate-days').send({ startDate: '2026-06-01', count: 14 });
    expect(gen.status).toBe(200);
    expect(gen.body.generated).toBeGreaterThan(0);
    const days = await jorge.get('/api/days?from=2026-06-01&to=2026-06-15');
    expect(days.body.days.length).toBe(gen.body.generated);

    const workouts = await jorge.post('/api/dev/generate-workouts');
    expect(workouts.body.added).toBe(6);
    // Idempotent by name.
    expect((await jorge.post('/api/dev/generate-workouts')).body.added).toBe(0);
  });

  it('validates generator input', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    await jorge.put('/api/settings').send({ weightUnit: 'lb', devMode: true });
    expect((await jorge.post('/api/dev/generate-days').send({ startDate: 'nope', count: 14 })).status).toBe(400);
    expect((await jorge.post('/api/dev/generate-days').send({ startDate: '2026-06-01', count: 91 })).status).toBe(400);
  });
});
