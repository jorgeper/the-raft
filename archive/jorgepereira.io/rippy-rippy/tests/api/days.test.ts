import { describe, it, expect } from 'vitest';
import { makeTestApp, loginAs, makeDay, JORGE } from './helpers';

describe('days API', () => {
  it('round-trips a day record', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    const day = makeDay('2026-07-01', { workoutName: 'Push Day' });
    const put = await jorge.put('/api/days/2026-07-01').send(day);
    expect(put.status).toBe(200);
    const get = await jorge.get('/api/days/2026-07-01');
    expect(get.body.day).toEqual(day);
  });

  it('404s for a day that was never touched', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    expect((await jorge.get('/api/days/2026-07-01')).status).toBe(404);
  });

  it('upserts — a second PUT replaces the day', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    await jorge.put('/api/days/2026-07-01').send(makeDay('2026-07-01'));
    await jorge.put('/api/days/2026-07-01').send(makeDay('2026-07-01', { exercises: [] }));
    const get = await jorge.get('/api/days/2026-07-01');
    expect(get.body.day.exercises).toEqual([]);
  });

  it('rejects invalid dates and payloads with 400', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    expect((await jorge.get('/api/days/2026-02-31')).status).toBe(400);
    expect((await jorge.put('/api/days/not-a-date').send(makeDay('2026-07-01'))).status).toBe(400);
    expect((await jorge.put('/api/days/2026-07-01').send({})).status).toBe(400);
    const longName = makeDay('2026-07-01', {
      exercises: [{ id: 'e', exerciseName: 'x'.repeat(81), sets: [] }],
    });
    expect((await jorge.put('/api/days/2026-07-01').send(longName)).status).toBe(400);
    expect((await jorge.get('/api/days?from=bad')).status).toBe(400);
  });

  it('trims exercise names server-side', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    const day = makeDay('2026-07-01', {
      exercises: [{ id: 'e', exerciseName: '  Bench Press  ', sets: [] }],
    });
    const put = await jorge.put('/api/days/2026-07-01').send(day);
    expect(put.body.day.exercises[0].exerciseName).toBe('Bench Press');
  });

  it('lists summaries within a range', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    await jorge.put('/api/days/2026-06-30').send(makeDay('2026-06-30'));
    await jorge.put('/api/days/2026-07-01').send(makeDay('2026-07-01', { workoutName: 'Push' }));
    await jorge.put('/api/days/2026-08-01').send(makeDay('2026-08-01'));
    const res = await jorge.get('/api/days?from=2026-07-01&to=2026-07-31');
    expect(res.body.days).toEqual([{ date: '2026-07-01', workoutName: 'Push', exerciseCount: 1 }]);
  });

  it('serves last-session stats and suggestions relative to a date', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    await jorge.put('/api/days/2026-07-01').send(makeDay('2026-07-01'));

    const stats = await jorge.get('/api/exercise-stats?date=2026-07-03&names=Bench Press,Squat');
    expect(stats.body.stats['Bench Press'].lastSession.maxWeight).toBe(155);
    expect(stats.body.stats['Squat'].lastSession).toBeNull();

    const suggestions = await jorge.get('/api/suggestions?date=2026-07-03');
    const bench = suggestions.body.suggestions.find((s: { name: string }) => s.name === 'Bench Press');
    expect(bench.lastSession.weight).toBe(135);
    // The seeded library isn't loaded in unit tests (in-memory DB), so the
    // suggestion list is exactly the logged history here.
    expect(suggestions.body.suggestions).toHaveLength(1);
  });
});
