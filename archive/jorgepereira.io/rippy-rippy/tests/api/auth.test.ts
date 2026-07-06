import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeTestApp, loginAs, JORGE, FRIEND } from './helpers';

describe('auth API (dev mode)', () => {
  it('reports the auth mode', async () => {
    const { app } = makeTestApp();
    const res = await request(app).get('/api/auth/mode');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ mode: 'dev' });
  });

  it('serves the health check without auth', async () => {
    const { app } = makeTestApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('lists allowed emails as dev users', async () => {
    const { app } = makeTestApp();
    const res = await request(app).get('/api/auth/dev-users');
    expect(res.status).toBe(200);
    expect(res.body.users).toEqual([
      { email: JORGE, name: 'jorge', avatar: null },
      { email: FRIEND, name: 'friend', avatar: null },
    ]);
  });

  it('logs in an allowed user and reports them via /api/me', async () => {
    const { app } = makeTestApp();
    const agent = await loginAs(app, JORGE);
    const me = await agent.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.user).toEqual({ email: JORGE, name: 'jorge', avatar: null });
  });

  it('normalizes email case on login', async () => {
    const { app, repo } = makeTestApp();
    const agent = await loginAs(app, 'JORGE@gmail.com');
    const me = await agent.get('/api/me');
    expect(me.body.user.email).toBe(JORGE);
    expect(repo.findUserByEmail(JORGE)).not.toBeNull();
  });

  it('creates the user row on first login, and reuses it after', async () => {
    const { app, repo } = makeTestApp();
    await loginAs(app, JORGE);
    const first = repo.findUserByEmail(JORGE)!;
    await loginAs(app, JORGE);
    expect(repo.findUserByEmail(JORGE)!.id).toBe(first.id);
  });

  it('rejects an email that is not on the list', async () => {
    const { app } = makeTestApp();
    const res = await request(app).post('/api/auth/dev-login').send({ email: 'stranger@gmail.com' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'not-on-list' });
  });

  it('returns a null user from /api/me when not logged in', async () => {
    const { app } = makeTestApp();
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it('logout clears the session', async () => {
    const { app } = makeTestApp();
    const agent = await loginAs(app, JORGE);
    const out = await agent.post('/api/auth/logout');
    expect(out.status).toBe(204);
    const me = await agent.get('/api/me');
    expect(me.body.user).toBeNull();
  });

  it('does not expose dev login endpoints in google mode', async () => {
    const { app } = makeTestApp({
      AUTH_MODE: 'google',
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
    });
    expect((await request(app).get('/api/auth/dev-users')).status).toBe(404);
    expect((await request(app).post('/api/auth/dev-login').send({ email: JORGE })).status).toBe(404);
    // …but the Google entry point exists.
    const start = await request(app).get('/auth/google');
    expect(start.status).toBe(302);
    expect(start.headers.location).toContain('accounts.google.com');
  });

  it('rejects a google callback with a mismatched state', async () => {
    const { app } = makeTestApp({
      AUTH_MODE: 'google',
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
    });
    const res = await request(app).get('/auth/google/callback?code=x&state=forged');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/not-allowed');
  });

  it('drops a session once the email is removed from the allowlist', async () => {
    // Simulate removal by logging into an app whose config no longer lists
    // the email: same cookie secret, different allowlist.
    const first = makeTestApp();
    const agent = await loginAs(first.app, FRIEND);
    const cookie = agent.jar.getCookies({ domain: '127.0.0.1', path: '/', script: false, secure: false });
    expect(cookie.length).toBeGreaterThan(0);

    const second = makeTestApp({ ALLOWED_EMAILS: JORGE });
    const cookieHeader = cookie.map((c) => `${c.name}=${c.value}`).join('; ');
    const me = await request(second.app).get('/api/me').set('Cookie', cookieHeader);
    expect(me.body.user).toBeNull();
    const days = await request(second.app).get('/api/days').set('Cookie', cookieHeader);
    expect(days.status).toBe(401);
  });
});
