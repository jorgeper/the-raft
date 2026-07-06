import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { makeTestApp, type TestApp } from './helpers';

async function loginParent(t: TestApp, email = 'mom@gmail.com'): Promise<TestAgent> {
  const agent = request.agent(t.app);
  const res = await agent.post('/api/auth/dev-login').send({ email });
  expect(res.status).toBe(200);
  return agent;
}

async function loginKid(t: TestApp, email: string): Promise<TestAgent> {
  const agent = request.agent(t.app);
  const res = await agent.post('/api/auth/dev-login').send({ email });
  expect(res.status).toBe(200);
  return agent;
}

describe('kids CRUD', () => {
  let t: TestApp;
  beforeEach(() => {
    t = makeTestApp();
  });

  it('creates a kid with an initial reset row and default allowance', async () => {
    const agent = await loginParent(t);
    const res = await agent.post('/api/kids').send({ name: 'Ana', email: 'ana@gmail.com' });
    expect(res.status).toBe(201);
    expect(res.body.kid.weeklyAllowance).toBe(100);

    const detail = await agent.get(`/api/kids/${res.body.kid.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.balance).toBe(100);
    expect(detail.body.transactions).toHaveLength(1);
    expect(detail.body.transactions[0]).toMatchObject({ type: 'reset', amount: 100, note: 'Weekly reset to 100' });
  });

  it('validates kid input', async () => {
    const agent = await loginParent(t);
    expect((await agent.post('/api/kids').send({ name: '', email: 'a@g.com' })).status).toBe(400);
    expect((await agent.post('/api/kids').send({ name: 'A', email: 'not-an-email' })).status).toBe(400);
    expect((await agent.post('/api/kids').send({ name: 'A', email: 'a@g.com', weeklyAllowance: -5 })).status).toBe(400);
    expect((await agent.post('/api/kids').send({ name: 'A', email: 'a@g.com', weeklyAllowance: 2.5 })).status).toBe(400);
  });

  it('rejects duplicate kid emails', async () => {
    const agent = await loginParent(t);
    await agent.post('/api/kids').send({ name: 'Ana', email: 'ana@gmail.com' });
    const dup = await agent.post('/api/kids').send({ name: 'Ana 2', email: 'ANA@gmail.com' });
    expect(dup.status).toBe(400);
    expect(dup.body.error).toBe('email-in-use');
  });

  it('lists kids with balance and 7-day chart', async () => {
    const agent = await loginParent(t);
    await agent.post('/api/kids').send({ name: 'Ana', email: 'ana@gmail.com', weeklyAllowance: 50 });
    const res = await agent.get('/api/kids');
    expect(res.status).toBe(200);
    expect(res.body.kids).toHaveLength(1);
    expect(res.body.kids[0].balance).toBe(50);
    expect(res.body.kids[0].chart).toHaveLength(7);
    expect(res.body.kids[0].chart[6].isToday).toBe(true);
  });

  it('updates a kid', async () => {
    const agent = await loginParent(t);
    const { body } = await agent.post('/api/kids').send({ name: 'Ana', email: 'ana@gmail.com' });
    const res = await agent.patch(`/api/kids/${body.kid.id}`).send({ name: 'Anita', weeklyAllowance: 200 });
    expect(res.status).toBe(200);
    expect(res.body.kid.name).toBe('Anita');
    expect(res.body.kid.weeklyAllowance).toBe(200);
  });

  it('archives a kid on delete', async () => {
    const agent = await loginParent(t);
    const { body } = await agent.post('/api/kids').send({ name: 'Ana', email: 'ana@gmail.com' });
    expect((await agent.delete(`/api/kids/${body.kid.id}`)).status).toBe(204);
    expect((await agent.get(`/api/kids/${body.kid.id}`)).status).toBe(404);
    expect((await agent.get('/api/kids')).body.kids).toHaveLength(0);
  });

  it('404s on a missing kid', async () => {
    const agent = await loginParent(t);
    expect((await agent.get('/api/kids/999')).status).toBe(404);
    expect((await agent.patch('/api/kids/999').send({ name: 'X' })).status).toBe(404);
    expect((await agent.post('/api/kids/999/transactions').send({ amount: 1, note: 'x', direction: 'add' })).status).toBe(404);
  });
});

describe('transactions', () => {
  let t: TestApp;
  let kidId: number;
  let agent: TestAgent;

  beforeEach(async () => {
    t = makeTestApp();
    agent = await loginParent(t);
    const res = await agent.post('/api/kids').send({ name: 'Ana', email: 'ana@gmail.com' });
    kidId = res.body.kid.id;
  });

  it('adds Buckos with a note and records the acting parent', async () => {
    const res = await agent.post(`/api/kids/${kidId}/transactions`).send({ amount: 5, note: 'Helped with dishes', direction: 'add' });
    expect(res.status).toBe(201);
    expect(res.body.balance).toBe(105);
    expect(res.body.transaction).toMatchObject({
      amount: 5,
      note: 'Helped with dishes',
      type: 'adjustment',
      actorEmail: 'mom@gmail.com',
    });
  });

  it('withdraws Buckos and allows negative balances', async () => {
    const res = await agent.post(`/api/kids/${kidId}/transactions`).send({ amount: 150, note: 'Broke a window', direction: 'withdraw' });
    expect(res.status).toBe(201);
    expect(res.body.balance).toBe(-50);
    expect(res.body.transaction.amount).toBe(-150);
  });

  it('validates amount and note', async () => {
    const bad = [
      { amount: 0, note: 'x', direction: 'add' },
      { amount: -5, note: 'x', direction: 'add' },
      { amount: 1.5, note: 'x', direction: 'add' },
      { amount: 5, note: '   ', direction: 'add' },
      { amount: 5, note: 'x', direction: 'sideways' },
    ];
    for (const body of bad) {
      expect((await agent.post(`/api/kids/${kidId}/transactions`).send(body)).status).toBe(400);
    }
  });
});

describe('weekly reset via API access', () => {
  it('applies the reset lazily when a parent loads kids after the boundary', async () => {
    const t = makeTestApp();
    const agent = await loginParent(t);
    const { body } = await agent.post('/api/kids').send({ name: 'Ana', email: 'ana@gmail.com' });
    await agent.post(`/api/kids/${body.kid.id}/transactions`).send({ amount: 40, note: 'chores', direction: 'withdraw' });

    // Cross the Monday boundary (created Tue Jun 2; next reset Mon Jun 8 00:00)
    t.clock.set(new Date(2026, 5, 9, 8));
    const res = await agent.get('/api/kids');
    expect(res.body.kids[0].balance).toBe(100);

    const detail = await agent.get(`/api/kids/${body.kid.id}`);
    const resets = detail.body.transactions.filter((x: { type: string }) => x.type === 'reset');
    expect(resets).toHaveLength(2);
    expect(resets[0].amount).toBe(40); // 60 -> 100 at the boundary
  });

  it('catches up multiple missed weeks', async () => {
    const t = makeTestApp();
    const agent = await loginParent(t);
    const { body } = await agent.post('/api/kids').send({ name: 'Ana', email: 'ana@gmail.com' });

    t.clock.set(new Date(2026, 5, 24, 12)); // 3 boundaries missed: Jun 8, 15, 22
    const detail = await agent.get(`/api/kids/${body.kid.id}`);
    const resets = detail.body.transactions.filter((x: { type: string }) => x.type === 'reset');
    expect(resets).toHaveLength(4); // initial + 3 catch-ups
    expect(detail.body.balance).toBe(100);
  });
});

describe('authorization matrix', () => {
  it('kid sessions get 403 on every parent endpoint; anonymous gets 401', async () => {
    const t = makeTestApp();
    const parent = await loginParent(t);
    const { body } = await parent.post('/api/kids').send({ name: 'Ana', email: 'ana@gmail.com' });
    const kidAgent = await loginKid(t, 'ana@gmail.com');

    const calls: Array<[string, 'get' | 'post' | 'patch' | 'delete', object?]> = [
      ['/api/kids', 'get'],
      ['/api/kids', 'post', { name: 'X', email: 'x@g.com' }],
      [`/api/kids/${body.kid.id}`, 'get'],
      [`/api/kids/${body.kid.id}`, 'patch', { name: 'X' }],
      [`/api/kids/${body.kid.id}`, 'delete'],
      [`/api/kids/${body.kid.id}/transactions`, 'post', { amount: 1, note: 'x', direction: 'add' }],
    ];
    for (const [url, method, payload] of calls) {
      const kidRes = await kidAgent[method](url).send(payload ?? {});
      expect(kidRes.status, `kid ${method} ${url}`).toBe(403);
      const anonRes = await request(t.app)[method](url).send(payload ?? {});
      expect(anonRes.status, `anon ${method} ${url}`).toBe(401);
    }
  });

  it('kid summary is kid-only and scoped to the logged-in kid', async () => {
    const t = makeTestApp();
    const parent = await loginParent(t);
    await parent.post('/api/kids').send({ name: 'Ana', email: 'ana@gmail.com' });
    await parent.post('/api/kids').send({ name: 'Ben', email: 'ben@gmail.com' });
    await parent.post('/api/kids').send({ name: 'X', email: 'x@gmail.com' }).expect(201);

    const anaAgent = await loginKid(t, 'ana@gmail.com');
    const res = await anaAgent.get('/api/kid/summary');
    expect(res.status).toBe(200);
    expect(res.body.kid.name).toBe('Ana');
    expect(res.body.balance).toBe(100);
    expect(res.body.chart).toHaveLength(7);
    expect(res.body.transactions.every((x: { kidId: number }) => x.kidId === res.body.kid.id)).toBe(true);

    expect((await parent.get('/api/kid/summary')).status).toBe(403);
    expect((await request(t.app).get('/api/kid/summary')).status).toBe(401);
  });
});

describe('test clock endpoint', () => {
  it('is 404 unless ENABLE_TEST_CLOCK=1', async () => {
    const t = makeTestApp();
    expect((await request(t.app).post('/api/test/clock').send({ time: '2026-06-09T08:00:00.000Z' })).status).toBe(404);
  });

  it('freezes and clears time when enabled', async () => {
    const t = makeTestApp({ ENABLE_TEST_CLOCK: '1' });
    const set = await request(t.app).post('/api/test/clock').send({ time: '2026-06-09T08:00:00.000Z' });
    expect(set.status).toBe(200);
    expect(t.clock.now().toISOString()).toBe('2026-06-09T08:00:00.000Z');
    const clear = await request(t.app).delete('/api/test/clock');
    expect(clear.status).toBe(200);
  });
});
