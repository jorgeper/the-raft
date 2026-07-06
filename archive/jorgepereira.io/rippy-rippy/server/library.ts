import fs from 'fs';
import path from 'path';
import type { Repo } from './repo';
import type { Library } from './types';

/**
 * The global exercise library ships as default-library.json at the app root
 * and is seeded into the database at startup. When the bundled file's version
 * is newer than what the DB holds, the DB copy is refreshed — the original
 * app cached the library in localStorage once and never saw updates again
 * (SPEC §7 bug #3).
 */

export function findDefaultLibraryFile(): string | null {
  const candidates = [
    path.resolve(__dirname, '../../default-library.json'), // dist/server → app root
    path.resolve(__dirname, '../default-library.json'), // server/ under tsx → app root
    path.resolve(process.cwd(), 'default-library.json'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export function loadDefaultLibrary(): Library | null {
  const file = findDefaultLibraryFile();
  if (!file) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Library;
    if (!data.version || !Array.isArray(data.exercises)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Compare dotted version strings numerically segment by segment. */
export function isNewerVersion(a: string, b: string): boolean {
  const as = a.split('.').map(Number);
  const bs = b.split('.').map(Number);
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const av = as[i] ?? 0;
    const bv = bs[i] ?? 0;
    if (av !== bv) return av > bv;
  }
  return false;
}

export function seedLibrary(repo: Repo, bundled: Library | null = loadDefaultLibrary()): void {
  if (!bundled) return;
  const existing = repo.getLibrary();
  if (!existing || isNewerVersion(bundled.version, existing.version)) {
    repo.setLibrary(bundled);
  }
}
