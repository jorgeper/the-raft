import type { Request, Response, NextFunction } from 'express';
import type { Config } from './config';
import type { Repo } from './repo';
import type { SessionUser } from './types';

/**
 * Resolve an email to a session user, or null if the email is not allowed.
 * Parents come from PARENT_EMAILS; kids must have a (non-archived) profile
 * created by a parent. Parent wins if an email is somehow both.
 */
export function resolveUser(email: string, cfg: Config, repo: Repo): SessionUser | null {
  const normalized = email.trim().toLowerCase();
  if (cfg.parentEmails.includes(normalized)) {
    return { email: normalized, role: 'parent' };
  }
  const kid = repo.findKidByEmail(normalized);
  if (kid) {
    return { email: normalized, role: 'kid', kidId: kid.id, name: kid.name };
  }
  return null;
}

export function sessionUser(req: Request): SessionUser | null {
  return (req.session as { user?: SessionUser } | null)?.user ?? null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!sessionUser(req)) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  next();
}

export function requireParent(req: Request, res: Response, next: NextFunction): void {
  const user = sessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  if (user.role !== 'parent') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}

export function requireKid(req: Request, res: Response, next: NextFunction): void {
  const user = sessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  if (user.role !== 'kid') {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  next();
}
