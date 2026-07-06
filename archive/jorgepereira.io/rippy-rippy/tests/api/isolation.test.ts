import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeTestApp, loginAs, makeDay, JORGE, FRIEND } from './helpers';

/**
 * The authorization matrix (SPEC §9): every endpoint rejects anonymous
 * callers, and no user can see or touch another user's data.
 */

const PROTECTED_ROUTES: Array<[method: 'get' | 'put' | 'post' | 'delete', path: string]> = [
  ['get', '/api/days'],
  ['get', '/api/days/2026-07-01'],
  ['put', '/api/days/2026-07-01'],
  ['get', '/api/exercise-stats?date=2026-07-01&names=Bench%20Press'],
  ['get', '/api/suggestions?date=2026-07-01'],
  ['get', '/api/analytics'],
  ['get', '/api/history?names=Bench%20Press'],
  ['get', '/api/workouts'],
  ['post', '/api/workouts'],
  ['put', '/api/workouts/1'],
  ['delete', '/api/workouts/1'],
  ['get', '/api/settings'],
  ['put', '/api/settings'],
  ['put', '/api/profile'],
  ['get', '/api/library'],
  ['get', '/api/export'],
  ['post', '/api/import'],
  ['post', '/api/dev/generate-days'],
  ['post', '/api/dev/generate-workouts'],
  ['post', '/api/dev/reset'],
];

describe('authorization matrix', () => {
  it('rejects every protected route without a session', async () => {
    const { app } = makeTestApp();
    for (const [method, path] of PROTECTED_ROUTES) {
      const res = await request(app)[method](path);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
    }
  });

  it('keeps two users’ days completely separate', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    const friend = await loginAs(app, FRIEND);

    const put = await jorge.put('/api/days/2026-07-01').send(makeDay('2026-07-01'));
    expect(put.status).toBe(200);

    // Jorge sees his day; friend gets 404 and an empty listing.
    expect((await jorge.get('/api/days/2026-07-01')).status).toBe(200);
    expect((await friend.get('/api/days/2026-07-01')).status).toBe(404);
    expect((await friend.get('/api/days')).body.days).toEqual([]);
    expect((await jorge.get('/api/days')).body.days).toHaveLength(1);

    // Friend's stats/analytics see none of Jorge's history.
    const stats = await friend.get('/api/exercise-stats?date=2026-07-02&names=Bench Press');
    expect(stats.body.stats['Bench Press'].lastSession).toBeNull();
    expect((await friend.get('/api/analytics')).body.stats.totalDays).toBe(0);
    expect((await friend.get('/api/export')).body.days).toEqual([]);

    // Friend writing the same date doesn't clobber Jorge's day.
    await friend.put('/api/days/2026-07-01').send(
      makeDay('2026-07-01', {
        exercises: [{ id: 'f1', exerciseName: 'Squat', sets: [{ weight: 200, reps: 5 }] }],
      })
    );
    const jorgeDay = await jorge.get('/api/days/2026-07-01');
    expect(jorgeDay.body.day.exercises[0].exerciseName).toBe('Bench Press');
  });

  it('keeps saved workouts separate and blocks cross-user mutation by id', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    const friend = await loginAs(app, FRIEND);

    const created = await jorge.post('/api/workouts').send({ name: 'Push Day', exercises: ['Bench Press'] });
    expect(created.status).toBe(201);
    const id = created.body.workout.id;

    expect((await friend.get('/api/workouts')).body.workouts).toEqual([]);
    expect((await friend.put(`/api/workouts/${id}`).send({ name: 'Hacked', exercises: ['Curl'] })).status).toBe(404);
    expect((await friend.delete(`/api/workouts/${id}`)).status).toBe(404);

    // Untouched for Jorge.
    const list = await jorge.get('/api/workouts');
    expect(list.body.workouts).toEqual([{ id, name: 'Push Day', exercises: ['Bench Press'] }]);
  });

  it('keeps settings and profile per-user', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    const friend = await loginAs(app, FRIEND);

    await jorge.put('/api/settings').send({ weightUnit: 'kg', devMode: true });
    await jorge.put('/api/profile').send({ name: 'El Rippy' });

    expect((await friend.get('/api/settings')).body.settings).toEqual({ weightUnit: 'lb', devMode: false });
    expect((await friend.get('/api/me')).body.user.name).toBe('friend');
    expect((await jorge.get('/api/me')).body.user.name).toBe('El Rippy');
  });

  it('dev reset only wipes the caller’s data', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    const friend = await loginAs(app, FRIEND);

    await jorge.put('/api/days/2026-07-01').send(makeDay('2026-07-01'));
    await friend.put('/api/days/2026-07-02').send(makeDay('2026-07-02'));
    await friend.put('/api/settings').send({ weightUnit: 'lb', devMode: true });

    expect((await friend.post('/api/dev/reset')).status).toBe(204);
    expect((await friend.get('/api/days')).body.days).toEqual([]);
    expect((await jorge.get('/api/days')).body.days).toHaveLength(1);
  });

  it('rejects dev endpoints when dev mode is off', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    for (const path of ['/api/dev/generate-days', '/api/dev/generate-workouts', '/api/dev/reset']) {
      const res = await jorge.post(path).send({ startDate: '2026-06-01', count: 5 });
      expect(res.status, path).toBe(403);
      expect(res.body).toEqual({ error: 'dev-mode-off' });
    }
  });
});
