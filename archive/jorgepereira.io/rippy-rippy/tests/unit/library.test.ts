import { describe, it, expect } from 'vitest';
import { isNewerVersion, loadDefaultLibrary, seedLibrary } from '../../server/library';
import { openDb } from '../../server/db';
import { SqliteRepo } from '../../server/sqliteRepo';

describe('isNewerVersion', () => {
  it('compares dotted versions numerically', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(true);
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true);
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(false);
    expect(isNewerVersion('2.0', '1.9.9')).toBe(true);
  });
});

describe('seedLibrary', () => {
  function makeRepo() {
    return new SqliteRepo(openDb(':memory:'));
  }

  it('seeds an empty database', () => {
    const repo = makeRepo();
    seedLibrary(repo, { version: '1.0.0', exercises: [{ name: 'A' }] });
    expect(repo.getLibrary()!.exercises).toEqual([{ name: 'A' }]);
  });

  it('refreshes when the bundled version is newer (original bug #3 regression)', () => {
    const repo = makeRepo();
    seedLibrary(repo, { version: '1.0.0', exercises: [{ name: 'Old' }] });
    seedLibrary(repo, { version: '1.1.0', exercises: [{ name: 'New' }] });
    expect(repo.getLibrary()!.exercises).toEqual([{ name: 'New' }]);
  });

  it('leaves the stored library alone when the bundled one is not newer', () => {
    const repo = makeRepo();
    seedLibrary(repo, { version: '1.1.0', exercises: [{ name: 'Current' }] });
    seedLibrary(repo, { version: '1.0.0', exercises: [{ name: 'Stale' }] });
    expect(repo.getLibrary()!.exercises).toEqual([{ name: 'Current' }]);
  });

  it('finds and parses the real default-library.json', () => {
    const lib = loadDefaultLibrary();
    expect(lib).not.toBeNull();
    expect(lib!.exercises.length).toBeGreaterThan(100);
    expect(lib!.exercises[0].name).toBeTruthy();
  });
});
