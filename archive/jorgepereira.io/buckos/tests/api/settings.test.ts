import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { makeTestApp } from './helpers';
import { recordGooglePicture } from '../../server/profiles';

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

  it('stores the parent profile name and avatar', async () => {
    const t = makeTestApp();
    const agent = await parentAgent(t);

    expect((await agent.get('/api/profile')).body).toEqual({ name: null, avatar: null, googlePicture: null });

    const avatar = 'data:image/jpeg;base64,abc123';
    const patch = await agent.patch('/api/profile').send({ name: 'Mamá', avatar });
    expect(patch.status).toBe(200);
    expect(patch.body).toEqual({ name: 'Mamá', avatar, googlePicture: null });

    // /api/me and the dev user picker pick up the new profile.
    expect((await agent.get('/api/me')).body.user).toMatchObject({ name: 'Mamá', avatar });
    const users = (await agent.get('/api/auth/dev-users')).body.users;
    expect(users.find((u: { email: string }) => u.email === 'mom@gmail.com')).toMatchObject({ name: 'Mamá', avatar });

    // Removing the photo.
    expect((await agent.patch('/api/profile').send({ avatar: null })).body.avatar).toBeNull();
  });

  it('rejects bad profile input', async () => {
    const t = makeTestApp();
    const agent = await parentAgent(t);
    expect((await agent.patch('/api/profile').send({ name: '  ' })).status).toBe(400);
    expect((await agent.patch('/api/profile').send({ avatar: 'http://evil/x.png' })).status).toBe(400);
    expect((await agent.patch('/api/profile').send({ avatar: `data:image/png;base64,${'a'.repeat(600_000)}` })).status).toBe(400);
  });

  it('lets a kid update only their own profile picture', async () => {
    const t = makeTestApp();
    const parent = await parentAgent(t);
    await parent.post('/api/kids').send({ name: 'Ana', email: 'ana@gmail.com' });
    const kidAgent = request.agent(t.app);
    await kidAgent.post('/api/auth/dev-login').send({ email: 'ana@gmail.com' });

    const avatar = 'data:image/jpeg;base64,selfie';
    const res = await kidAgent.patch('/api/kid/profile').send({ avatar });
    expect(res.status).toBe(200);
    expect(res.body.avatar).toBe(avatar);
    expect((await kidAgent.get('/api/me')).body.user.avatar).toBe(avatar);

    expect((await kidAgent.patch('/api/kid/profile').send({ avatar: 'nope' })).status).toBe(400);
    // Parents use the kid form for this; anon is rejected.
    expect((await parent.patch('/api/kid/profile').send({ avatar })).status).toBe(403);
    expect((await request(t.app).patch('/api/kid/profile').send({ avatar })).status).toBe(401);
  });

  it('falls back to the Google photo and lets the app photo win', async () => {
    const t = makeTestApp();
    const parent = await parentAgent(t);
    await parent.post('/api/kids').send({ name: 'Ana', email: 'ana@gmail.com' });
    const kidAgent = request.agent(t.app);
    await kidAgent.post('/api/auth/dev-login').send({ email: 'ana@gmail.com' });

    // Simulate what the Google callback records at sign-in.
    recordGooglePicture(t.repo, { role: 'kid', email: 'ana@gmail.com', kidId: 1 }, 'https://lh3.googleusercontent.com/ana');
    recordGooglePicture(t.repo, { role: 'parent', email: 'mom@gmail.com' }, 'https://lh3.googleusercontent.com/mom');

    // No app photo yet → Google photo is the effective avatar everywhere.
    expect((await kidAgent.get('/api/me')).body.user.avatar).toBe('https://lh3.googleusercontent.com/ana');
    expect((await parent.get('/api/me')).body.user.avatar).toBe('https://lh3.googleusercontent.com/mom');
    expect((await kidAgent.get('/api/kid/profile')).body).toEqual({
      avatar: null,
      googlePicture: 'https://lh3.googleusercontent.com/ana',
    });

    // App-set photo overrides…
    const custom = 'data:image/jpeg;base64,custom';
    await kidAgent.patch('/api/kid/profile').send({ avatar: custom });
    expect((await kidAgent.get('/api/me')).body.user.avatar).toBe(custom);
    await parent.patch('/api/profile').send({ avatar: custom });
    expect((await parent.get('/api/me')).body.user.avatar).toBe(custom);

    // …and removing it falls back to the Google photo.
    await kidAgent.patch('/api/kid/profile').send({ avatar: null });
    expect((await kidAgent.get('/api/me')).body.user.avatar).toBe('https://lh3.googleusercontent.com/ana');
    await parent.patch('/api/profile').send({ avatar: null });
    expect((await parent.get('/api/me')).body.user.avatar).toBe('https://lh3.googleusercontent.com/mom');

    // Non-https values are ignored rather than stored.
    recordGooglePicture(t.repo, { role: 'kid', email: 'ana@gmail.com', kidId: 1 }, 'javascript:alert(1)');
    expect((await kidAgent.get('/api/kid/profile')).body.googlePicture).toBeNull();
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
    expect((await kidAgent.get('/api/profile')).status).toBe(403);
    expect((await kidAgent.patch('/api/profile').send({ name: 'X' })).status).toBe(403);
    expect((await request(t.app).get('/api/profile')).status).toBe(401);
  });
});
