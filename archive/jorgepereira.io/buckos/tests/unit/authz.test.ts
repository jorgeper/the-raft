import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../server/db';
import { SqliteRepo } from '../../server/sqliteRepo';
import type { Repo } from '../../server/repo';
import { resolveUser } from '../../server/authz';
import { loadConfig, type Config } from '../../server/config';

describe('resolveUser', () => {
  let repo: Repo;
  let cfg: Config;

  beforeEach(() => {
    repo = new SqliteRepo(openDb(':memory:'));
    cfg = loadConfig({
      AUTH_MODE: 'dev',
      PARENT_EMAILS: 'Mom@Gmail.com , dad@gmail.com',
      SESSION_SECRET: 'test',
    } as NodeJS.ProcessEnv);
  });

  it('resolves parent emails case-insensitively, tolerating whitespace in config', () => {
    expect(resolveUser('mom@gmail.com', cfg, repo)).toEqual({ email: 'mom@gmail.com', role: 'parent' });
    expect(resolveUser('DAD@GMAIL.COM', cfg, repo)?.role).toBe('parent');
  });

  it('resolves a registered kid email to the kid role with kidId and name', () => {
    const kid = repo.createKid({ name: 'Ana', email: 'ana@gmail.com', weeklyAllowance: 100, createdAt: '2026-06-01T00:00:00.000Z' });
    expect(resolveUser('Ana@gmail.com', cfg, repo)).toEqual({ email: 'ana@gmail.com', role: 'kid', kidId: kid.id, name: 'Ana' });
  });

  it('rejects archived kids', () => {
    const kid = repo.createKid({ name: 'Ana', email: 'ana@gmail.com', weeklyAllowance: 100, createdAt: '2026-06-01T00:00:00.000Z' });
    repo.archiveKid(kid.id);
    expect(resolveUser('ana@gmail.com', cfg, repo)).toBeNull();
  });

  it('rejects unknown emails', () => {
    expect(resolveUser('stranger@gmail.com', cfg, repo)).toBeNull();
  });

  it('parent role wins if a parent email is also registered as a kid', () => {
    repo.createKid({ name: 'M', email: 'mom@gmail.com', weeklyAllowance: 100, createdAt: '2026-06-01T00:00:00.000Z' });
    expect(resolveUser('mom@gmail.com', cfg, repo)?.role).toBe('parent');
  });
});
