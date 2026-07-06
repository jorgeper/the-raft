import { describe, it, expect } from 'vitest';
import { makeTestApp, loginAs, JORGE } from './helpers';

describe('saved workouts API', () => {
  it('creates, lists, updates, and deletes a workout', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);

    const created = await jorge.post('/api/workouts').send({ name: 'Push Day', exercises: ['Bench Press', 'Overhead Press'] });
    expect(created.status).toBe(201);
    const id = created.body.workout.id;

    const updated = await jorge.put(`/api/workouts/${id}`).send({ name: 'Push Day A', exercises: ['Bench Press'] });
    expect(updated.status).toBe(200);
    expect(updated.body.workout).toEqual({ id, name: 'Push Day A', exercises: ['Bench Press'] });

    expect((await jorge.get('/api/workouts')).body.workouts).toHaveLength(1);
    expect((await jorge.delete(`/api/workouts/${id}`)).status).toBe(204);
    expect((await jorge.get('/api/workouts')).body.workouts).toEqual([]);
  });

  it('saving under an existing name (case-insensitive) updates that workout', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    const first = await jorge.post('/api/workouts').send({ name: 'Push Day', exercises: ['Bench Press'] });
    const second = await jorge.post('/api/workouts').send({ name: 'push day', exercises: ['Cable Fly'] });
    expect(second.status).toBe(200);
    expect(second.body.workout.id).toBe(first.body.workout.id);
    const list = await jorge.get('/api/workouts');
    expect(list.body.workouts).toEqual([{ id: first.body.workout.id, name: 'push day', exercises: ['Cable Fly'] }]);
  });

  it('validates names and exercise lists', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    expect((await jorge.post('/api/workouts').send({ name: '', exercises: ['X'] })).status).toBe(400);
    expect((await jorge.post('/api/workouts').send({ name: 'Ok', exercises: [] })).status).toBe(400);
    expect((await jorge.post('/api/workouts').send({ name: 'Ok', exercises: ['x'.repeat(81)] })).status).toBe(400);
    expect((await jorge.put('/api/workouts/999').send({ name: 'Ok', exercises: ['X'] })).status).toBe(404);
    expect((await jorge.delete('/api/workouts/999')).status).toBe(404);
  });
});
