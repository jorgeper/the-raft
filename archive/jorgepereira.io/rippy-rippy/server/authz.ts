import type { Request, Response, NextFunction } from 'express';
import type { Config } from './config';
import type { Repo } from './repo';
import type { SessionUser, User } from './types';

/**
 * Resolve an email to a session user, or null if the email is not allowed.
 * Access is the ALLOWED_EMAILS allowlist; a user row is created on first
 * sign-in so profile/settings/data have somewhere to live.
 */
export function resolveUser(email: string, cfg: Config, repo: Repo): SessionUser | null {
  const normalized = email.trim().toLowerCase();
  if (!cfg.allowedEmails.includes(normalized)) return null;
  const user = repo.findUserByEmail(normalized) ?? repo.createUser(normalized);
  return { userId: user.id, email: normalized };
}

export function sessionUser(req: Request): SessionUser | null {
  return (req.session as { user?: SessionUser } | null)?.user ?? null;
}

/** The session user's row; only call from routes behind requireAuth. */
export function currentUser(req: Request, repo: Repo): User {
  const session = sessionUser(req);
  const user = session ? repo.getUser(session.userId) : null;
  if (!user) throw new Error('currentUser called without an authenticated session');
  return user;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!sessionUser(req)) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  next();
}
