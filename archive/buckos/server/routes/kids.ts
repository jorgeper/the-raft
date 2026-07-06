import { Router } from 'express';
import type { AppDeps } from '../app';
import { requireParent, sessionUser } from '../authz';
import { chartData, ensureResets, RESET_NOTE } from '../ledger';
import { defaultAllowance } from './settings';
import type { Kid } from '../types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function badRequest(res: import('express').Response, error: string): void {
  res.status(400).json({ error });
}

function parseAllowance(value: unknown, fallback: number): number | null {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

export function kidsRoutes(deps: AppDeps): Router {
  const { repo, clock, config } = deps;
  const router = Router();

  router.use('/api/kids', requireParent);

  const withDerived = (kid: Kid) => {
    ensureResets(repo, kid, clock, config);
    return { ...kid, balance: repo.balance(kid.id), chart: chartData(repo, kid.id, clock) };
  };

  router.get('/api/kids', (_req, res) => {
    res.json({ kids: repo.listKids().map(withDerived) });
  });

  router.post('/api/kids', (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const weeklyAllowance = parseAllowance(req.body?.weeklyAllowance, defaultAllowance(repo));
    if (!name) return badRequest(res, 'name-required');
    if (!EMAIL_RE.test(email)) return badRequest(res, 'invalid-email');
    if (weeklyAllowance === null) return badRequest(res, 'invalid-allowance');
    if (repo.findKidByEmail(email)) return badRequest(res, 'email-in-use');

    const now = clock.now().toISOString();
    const kid = repo.createKid({ name, email, weeklyAllowance, createdAt: now });
    repo.addTxn({
      kidId: kid.id,
      amount: weeklyAllowance,
      note: RESET_NOTE(weeklyAllowance),
      type: 'reset',
      actorEmail: null,
      createdAt: now,
    });
    res.status(201).json({ kid: withDerived(kid) });
  });

  router.get('/api/kids/:id', (req, res) => {
    const kid = repo.getKid(Number(req.params.id));
    if (!kid) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    const derived = withDerived(kid);
    res.json({ kid, balance: derived.balance, chart: derived.chart, transactions: repo.listTxns(kid.id) });
  });

  router.patch('/api/kids/:id', (req, res) => {
    const kid = repo.getKid(Number(req.params.id));
    if (!kid) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    const patch: { name?: string; email?: string; weeklyAllowance?: number } = {};
    if (req.body?.name !== undefined) {
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!name) return badRequest(res, 'name-required');
      patch.name = name;
    }
    if (req.body?.email !== undefined) {
      const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      if (!EMAIL_RE.test(email)) return badRequest(res, 'invalid-email');
      const existing = repo.findKidByEmail(email);
      if (existing && existing.id !== kid.id) return badRequest(res, 'email-in-use');
      patch.email = email;
    }
    if (req.body?.weeklyAllowance !== undefined) {
      const allowance = parseAllowance(req.body.weeklyAllowance, kid.weeklyAllowance);
      if (allowance === null) return badRequest(res, 'invalid-allowance');
      patch.weeklyAllowance = allowance;
    }
    res.json({ kid: repo.updateKid(kid.id, patch) });
  });

  router.delete('/api/kids/:id', (req, res) => {
    const kid = repo.getKid(Number(req.params.id));
    if (!kid) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    repo.archiveKid(kid.id);
    res.status(204).end();
  });

  router.post('/api/kids/:id/transactions', (req, res) => {
    const kid = repo.getKid(Number(req.params.id));
    if (!kid) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    const amount = Number(req.body?.amount);
    const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
    const direction = req.body?.direction;
    if (!Number.isInteger(amount) || amount <= 0) return badRequest(res, 'invalid-amount');
    if (direction !== 'add' && direction !== 'withdraw') return badRequest(res, 'invalid-direction');

    // Apply any pending weekly reset first so it lands before this entry.
    ensureResets(repo, kid, clock, config);
    const txn = repo.addTxn({
      kidId: kid.id,
      amount: direction === 'add' ? amount : -amount,
      note,
      type: 'adjustment',
      actorEmail: sessionUser(req)!.email,
      createdAt: clock.now().toISOString(),
    });
    res.status(201).json({ transaction: txn, balance: repo.balance(kid.id) });
  });

  return router;
}
