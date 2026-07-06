import { Router } from 'express';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import type { AppDeps } from '../app';
import { resolveUser, sessionUser } from '../authz';
import { getProfile } from '../profiles';
import type { SessionUser } from '../types';

type SessionData = { user?: SessionUser; oauthState?: string } | null;

function session(req: { session?: unknown }): NonNullable<SessionData> {
  return (req.session ?? {}) as NonNullable<SessionData>;
}

/**
 * Sessions can outlive permissions (kid archived, parent removed from the
 * allowlist). Re-check the session email on every API request and drop
 * sessions that are no longer allowed.
 */
export function revalidateSession(deps: AppDeps) {
  const { config, repo } = deps;
  return (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
    const user = sessionUser(req);
    if (user) {
      const fresh = resolveUser(user.email, config, repo);
      if (!fresh || fresh.role !== user.role || fresh.kidId !== user.kidId) {
        (req.session as { user?: SessionUser }).user = fresh ?? undefined;
      }
    }
    next();
  };
}

export function authRoutes(deps: AppDeps): Router {
  const { config, repo } = deps;
  const router = Router();

  router.get('/api/auth/mode', (_req, res) => {
    res.json({ mode: config.authMode });
  });

  // Always 200 — a logged-out visitor is a normal state, not an error, and a
  // 401 here would log console noise on every login-page load. Name and photo
  // are looked up fresh (never stored in the cookie — avatars are far too big).
  router.get('/api/me', (req, res) => {
    const user = sessionUser(req);
    if (!user) {
      res.json({ user: null });
      return;
    }
    if (user.role === 'parent') {
      const profile = getProfile(repo, user.email);
      res.json({ user: { ...user, name: profile.name ?? user.name, avatar: profile.avatar } });
    } else {
      const kid = user.kidId !== undefined ? repo.getKid(user.kidId) : undefined;
      res.json({ user: { ...user, name: kid?.name ?? user.name, avatar: kid?.avatar ?? null } });
    }
  });

  router.post('/api/auth/logout', (req, res) => {
    req.session = null;
    res.status(204).end();
  });

  if (config.authMode === 'dev') {
    // Dev auth: pick any allowed user, no Google needed.
    router.get('/api/auth/dev-users', (_req, res) => {
      const parents = config.parentEmails.map((email) => {
        const profile = getProfile(repo, email);
        return {
          email,
          role: 'parent' as const,
          name: profile.name ?? email.split('@')[0],
          avatar: profile.avatar,
        };
      });
      const kids = repo
        .listKids()
        .map((k) => ({ email: k.email.toLowerCase(), role: 'kid' as const, name: k.name, avatar: k.avatar }));
      res.json({ users: [...parents, ...kids] });
    });

    router.post('/api/auth/dev-login', (req, res) => {
      const email = typeof req.body?.email === 'string' ? req.body.email : '';
      const user = resolveUser(email, config, repo);
      if (!user) {
        res.status(403).json({ error: 'not-on-list' });
        return;
      }
      session(req).user = user;
      req.session = session(req);
      res.json({ user });
    });
  }

  if (config.authMode === 'google') {
    const redirectUri = `${config.appOrigin}/auth/google/callback`;
    const client = new OAuth2Client(config.googleClientId, config.googleClientSecret, redirectUri);

    router.get('/auth/google', (req, res) => {
      const state = crypto.randomBytes(16).toString('hex');
      const s = session(req);
      s.oauthState = state;
      req.session = s;
      const url = client.generateAuthUrl({
        scope: ['openid', 'email', 'profile'],
        state,
        prompt: 'select_account',
      });
      res.redirect(url);
    });

    router.get('/auth/google/callback', async (req, res) => {
      try {
        const s = session(req);
        const { code, state } = req.query as { code?: string; state?: string };
        if (!code || !state || state !== s.oauthState) {
          res.redirect('/not-allowed');
          return;
        }
        delete s.oauthState;
        const { tokens } = await client.getToken(code);
        const ticket = await client.verifyIdToken({ idToken: tokens.id_token ?? '', audience: config.googleClientId });
        const email = ticket.getPayload()?.email;
        const user = email ? resolveUser(email, config, repo) : null;
        if (!user) {
          req.session = s;
          res.redirect('/not-allowed');
          return;
        }
        s.user = user;
        req.session = s;
        res.redirect('/');
      } catch (err) {
        console.error('Google OAuth callback failed:', err);
        res.redirect('/not-allowed');
      }
    });
  }

  return router;
}
