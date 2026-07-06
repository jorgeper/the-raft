import { Router } from 'express';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import type { AppDeps } from '../app';
import { resolveUser, sessionUser } from '../authz';
import type { SessionUser } from '../types';

type SessionData = { user?: SessionUser; oauthState?: string } | null;

function session(req: { session?: unknown }): NonNullable<SessionData> {
  return (req.session ?? {}) as NonNullable<SessionData>;
}

/**
 * Sessions can outlive permissions (an email removed from ALLOWED_EMAILS).
 * Re-check the session email on every request and drop stale sessions.
 */
export function revalidateSession(deps: AppDeps) {
  const { config, repo } = deps;
  return (
    req: import('express').Request,
    _res: import('express').Response,
    next: import('express').NextFunction
  ) => {
    const user = sessionUser(req);
    if (user) {
      const fresh = resolveUser(user.email, config, repo);
      if (!fresh || fresh.userId !== user.userId) {
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

  // Always 200 — a logged-out visitor is a normal state, not an error. Name
  // and photo are looked up fresh (never stored in the cookie).
  router.get('/api/me', (req, res) => {
    const session = sessionUser(req);
    if (!session) {
      res.json({ user: null });
      return;
    }
    const user = repo.getUser(session.userId);
    if (!user) {
      res.json({ user: null });
      return;
    }
    res.json({
      user: {
        email: user.email,
        name: user.name ?? user.email.split('@')[0],
        avatar: user.avatar ?? user.googlePicture,
      },
    });
  });

  router.post('/api/auth/logout', (req, res) => {
    req.session = null;
    res.status(204).end();
  });

  if (config.authMode === 'dev') {
    // Dev auth: pick any allowed user, no Google needed.
    router.get('/api/auth/dev-users', (_req, res) => {
      const users = config.allowedEmails.map((email) => {
        const user = repo.findUserByEmail(email);
        return {
          email,
          name: user?.name ?? email.split('@')[0],
          avatar: user?.avatar ?? user?.googlePicture ?? null,
        };
      });
      res.json({ users });
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
        const ticket = await client.verifyIdToken({
          idToken: tokens.id_token ?? '',
          audience: config.googleClientId,
        });
        const payload = ticket.getPayload();
        const email = payload?.email;
        const user = email ? resolveUser(email, config, repo) : null;
        if (!user) {
          req.session = s;
          res.redirect('/not-allowed');
          return;
        }
        // Refresh the Google photo, and default the display name on first login.
        const row = repo.getUser(user.userId)!;
        const picture =
          typeof payload?.picture === 'string' && payload.picture.startsWith('https://')
            ? payload.picture
            : null;
        repo.updateUser(user.userId, {
          googlePicture: picture,
          name: row.name ?? (typeof payload?.name === 'string' ? payload.name : null),
        });
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
