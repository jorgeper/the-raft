import { Router } from 'express';
import type { AppDeps } from '../app';
import { requireParent, sessionUser } from '../authz';
import { chartData, ensureResets, RESET_NOTE } from '../ledger';
import { defaultAllowance } from './settings';
import { isValidAvatar } from '../profiles';
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
    const avatar = req.body?.avatar === undefined ? null : req.body.avatar;
    if (!name) return badRequest(res, 'name-required');
    if (!EMAIL_RE.test(email)) return badRequest(res, 'invalid-email');
    if (weeklyAllowance === null) return badRequest(res, 'invalid-allowance');
    if (!isValidAvatar(avatar)) return badRequest(res, 'invalid-avatar');
    if (repo.findKidByEmail(email)) return badRequest(res, 'email-in-use');

    const now = clock.now().toISOString();
    const kid = repo.createKid({ name, email, weeklyAllowance, createdAt: now, avatar });
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
    const patch: { name?: string; email?: string; weeklyAllowance?: number; avatar?: string | null } = {};
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
    if (req.body?.avatar !== undefined) {
      if (!isValidAvatar(req.body.avatar)) return badRequest(res, 'invalid-avatar');
      patch.avatar = req.body.avatar;
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

  // Delete a ledger entry. Reset rows store the delta that landed the balance
  // on the allowance, so when the deleted entry has a reset after it, that
  // reset's delta absorbs the removed amount — every balance from the reset
  // onward (including the current one) stays exactly as it was. An entry from
  // the current week has no reset after it, so the balance updates.
  router.delete('/api/kids/:id/transactions/:txnId', (req, res) => {
    const kid = repo.getKid(Number(req.params.id));
    if (!kid) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    const txn = repo.getTxn(Number(req.params.txnId));
    if (!txn || txn.kidId !== kid.id) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    if (txn.type === 'reset') {
      badRequest(res, 'cannot-delete-reset');
      return;
    }

    ensureResets(repo, kid, clock, config);
    const chronological = repo.listTxns(kid.id).slice().reverse();
    const idx = chronological.findIndex((t) => t.id === txn.id);
    const nextReset = chronological.slice(idx + 1).find((t) => t.type === 'reset');
    if (nextReset) {
      repo.setTxnAmount(nextReset.id, nextReset.amount + txn.amount);
    }
    repo.deleteTxn(txn.id);
    res.json({ balance: repo.balance(kid.id) });
  });

  return router;
}
