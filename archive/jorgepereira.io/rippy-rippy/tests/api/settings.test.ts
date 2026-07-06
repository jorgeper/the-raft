import { describe, it, expect } from 'vitest';
import { makeTestApp, loginAs, JORGE } from './helpers';
import { seedLibrary } from '../../server/library';

describe('settings & profile API', () => {
  it('defaults settings and round-trips updates', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    expect((await jorge.get('/api/settings')).body.settings).toEqual({ weightUnit: 'lb', devMode: false });
    const put = await jorge.put('/api/settings').send({ weightUnit: 'kg', devMode: true });
    expect(put.body.settings).toEqual({ weightUnit: 'kg', devMode: true });
    expect((await jorge.get('/api/settings')).body.settings).toEqual({ weightUnit: 'kg', devMode: true });
  });

  it('rejects invalid settings', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    expect((await jorge.put('/api/settings').send({ weightUnit: 'stone', devMode: false })).status).toBe(400);
    expect((await jorge.put('/api/settings').send({ weightUnit: 'lb', devMode: 'yes' })).status).toBe(400);
  });

  it('updates the display name and reflects it in /api/me', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    const res = await jorge.put('/api/profile').send({ name: 'El Rippy' });
    expect(res.body.user.name).toBe('El Rippy');
    expect((await jorge.get('/api/me')).body.user.name).toBe('El Rippy');
    expect((await jorge.get('/api/profile')).body.profile.name).toBe('El Rippy');
  });

  it('sets a custom avatar and reverts to the Google photo', async () => {
    const { app, repo } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    // Simulate a Google photo recorded at sign-in.
    const user = repo.findUserByEmail(JORGE)!;
    repo.updateUser(user.id, { googlePicture: 'https://lh3.example.com/photo.jpg' });

    const custom = 'data:image/jpeg;base64,abc123';
    const set = await jorge.put('/api/profile').send({ avatar: custom });
    expect(set.body.user.avatar).toBe(custom);
    expect(set.body.user.hasCustomAvatar).toBe(true);

    const reverted = await jorge.put('/api/profile').send({ useGooglePhoto: true });
    expect(reverted.body.user.avatar).toBe('https://lh3.example.com/photo.jpg');
    expect(reverted.body.user.hasCustomAvatar).toBe(false);

    const profile = await jorge.get('/api/profile');
    expect(profile.body.profile.customAvatar).toBeNull();
    expect(profile.body.profile.googlePicture).toBe('https://lh3.example.com/photo.jpg');
  });

  it('rejects bad avatars and names', async () => {
    const { app } = makeTestApp();
    const jorge = await loginAs(app, JORGE);
    expect((await jorge.put('/api/profile').send({ avatar: 'https://evil.com/x.png' })).status).toBe(400);
    expect((await jorge.put('/api/profile').send({ name: '' })).status).toBe(400);
    expect((await jorge.put('/api/profile').send({ name: 'x'.repeat(81) })).status).toBe(400);
  });

  it('serves the seeded library', async () => {
    const { app, repo } = makeTestApp();
    seedLibrary(repo, { version: '2.0.0', exercises: [{ name: 'Test Press' }] });
    const jorge = await loginAs(app, JORGE);
    const res = await jorge.get('/api/library');
    expect(res.body.library.version).toBe('2.0.0');
    expect(res.body.library.exercises).toEqual([{ name: 'Test Press' }]);
  });
});
