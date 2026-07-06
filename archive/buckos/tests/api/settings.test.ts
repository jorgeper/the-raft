import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeTestApp } from './helpers';

async function parentAgent(t: ReturnType<typeof makeTestApp>) {
  const agent = request.agent(t.app);
  await agent.post('/api/auth/dev-login').send({ email: 'mom@gmail.com' });
  return agent;
}

describe('family settings', () => {
  it('defaults the weekly allowance to 100', async () => {
    const t = makeTestApp();
    const agent = await parentAgent(t);
    const res = await agent.get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ weeklyAllowance: 100 });
  });

  it('updates the allowance for every kid and for new kids', async () => {
    const t = makeTestApp();
    const agent = await parentAgent(t);
    const { body: created } = await agent.post('/api/kids').send({ name: 'Ana', email: 'ana@gmail.com' });
    expect(created.kid.weeklyAllowance).toBe(100);

    const patch = await agent.patch('/api/settings').send({ weeklyAllowance: 250 });
    expect(patch.status).toBe(200);
    expect(patch.body).toEqual({ weeklyAllowance: 250 });

    // Existing kid updated…
    const detail = await agent.get(`/api/kids/${created.kid.id}`);
    expect(detail.body.kid.weeklyAllowance).toBe(250);
    // …and new kids inherit the new default.
    const { body: next } = await agent.post('/api/kids').send({ name: 'Ben', email: 'ben@gmail.com' });
    expect(next.kid.weeklyAllowance).toBe(250);
    // Setting survives a fresh read.
    expect((await agent.get('/api/settings')).body.weeklyAllowance).toBe(250);
  });

  it('rejects invalid allowances', async () => {
    const t = makeTestApp();
    const agent = await parentAgent(t);
    for (const weeklyAllowance of [-1, 2.5, 'lots', null]) {
      expect((await agent.patch('/api/settings').send({ weeklyAllowance })).status).toBe(400);
    }
  });

  it('is parent-only', async () => {
    const t = makeTestApp();
    const parent = await parentAgent(t);
    await parent.post('/api/kids').send({ name: 'Ana', email: 'ana@gmail.com' });
    const kidAgent = request.agent(t.app);
    await kidAgent.post('/api/auth/dev-login').send({ email: 'ana@gmail.com' });

    expect((await kidAgent.get('/api/settings')).status).toBe(403);
    expect((await kidAgent.patch('/api/settings').send({ weeklyAllowance: 1 })).status).toBe(403);
    expect((await request(t.app).get('/api/settings')).status).toBe(401);
  });
});
