import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeTestApp } from './helpers';

describe('auth API (dev mode)', () => {
  it('reports the auth mode', async () => {
    const { app } = makeTestApp();
    const res = await request(app).get('/api/auth/mode');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: 'dev' });
  });

  it('lists parents and kids as dev users', async () => {
    const { app, repo } = makeTestApp();
    repo.createKid({ name: 'Ana', email: 'ana@gmail.com', weeklyAllowance: 100, createdAt: '2026-06-01T00:00:00.000Z' });
    const res = await request(app).get('/api/auth/dev-users');
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([
      { email: 'mom@gmail.com', role: 'parent', name: 'mom' },
      { email: 'dad@gmail.com', role: 'parent', name: 'dad' },
      { email: 'ana@gmail.com', role: 'kid', name: 'Ana' },
    ]);
  });

  it('logs a parent in and reports them via /api/me', async () => {
    const { app } = makeTestApp();
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/dev-login').send({ email: 'mom@gmail.com' });
    expect(login.status).toBe(200);
    expect(login.body.user).toEqual({ email: 'mom@gmail.com', role: 'parent' });

    const me = await agent.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe('parent');
  });

  it('logs a kid in with their kidId', async () => {
    const { app, repo } = makeTestApp();
    const kid = repo.createKid({ name: 'Ana', email: 'ana@gmail.com', weeklyAllowance: 100, createdAt: '2026-06-01T00:00:00.000Z' });
    const agent = request.agent(app);
    const login = await agent.post('/api/auth/dev-login').send({ email: 'ANA@gmail.com' });
    expect(login.status).toBe(200);
    expect(login.body.user).toEqual({ email: 'ana@gmail.com', role: 'kid', kidId: kid.id, name: 'Ana' });
  });

  it('rejects an email that is not on the list', async () => {
    const { app } = makeTestApp();
    const res = await request(app).post('/api/auth/dev-login').send({ email: 'stranger@gmail.com' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'not-on-list' });
  });

  it('returns 401 from /api/me when not logged in', async () => {
    const { app } = makeTestApp();
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });

  it('logout clears the session', async () => {
    const { app } = makeTestApp();
    const agent = request.agent(app);
    await agent.post('/api/auth/dev-login').send({ email: 'mom@gmail.com' });
    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(204);
    const me = await agent.get('/api/me');
    expect(me.status).toBe(401);
  });

  it('drops a kid session once the kid is archived', async () => {
    const { app, repo } = makeTestApp();
    const kid = repo.createKid({ name: 'Ana', email: 'ana@gmail.com', weeklyAllowance: 100, createdAt: '2026-06-01T00:00:00.000Z' });
    const agent = request.agent(app);
    await agent.post('/api/auth/dev-login').send({ email: 'ana@gmail.com' });
    repo.archiveKid(kid.id);
    const me = await agent.get('/api/me');
    expect(me.status).toBe(401);
  });
});

describe('auth API (google mode)', () => {
  const googleEnv = {
    AUTH_MODE: 'google',
    GOOGLE_CLIENT_ID: 'test-client-id',
    GOOGLE_CLIENT_SECRET: 'test-client-secret',
  };

  it('hides dev-only routes', async () => {
    const { app } = makeTestApp(googleEnv);
    expect((await request(app).get('/api/auth/dev-users')).status).toBe(404);
    expect((await request(app).post('/api/auth/dev-login').send({ email: 'mom@gmail.com' })).status).toBe(404);
  });

  it('redirects /auth/google to Google with client id and state', async () => {
    const { app } = makeTestApp(googleEnv);
    const res = await request(app).get('/auth/google');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
    expect(res.headers.location).toContain('test-client-id');
    expect(res.headers.location).toContain('state=');
  });

  it('rejects a callback with a bad state', async () => {
    const { app } = makeTestApp(googleEnv);
    const res = await request(app).get('/auth/google/callback?code=x&state=forged');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/not-allowed');
  });
});
