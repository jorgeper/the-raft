import { describe, it, expect } from 'vitest';
import { makeRng, hash2 } from '../src/utils/rng.js';
import { eligibleTypes, pickWeighted, spawnSpacing } from '../src/obstacles/tables.js';

describe('seeded RNG (spec §10, §11)', () => {
  it('same seed → identical sequence', () => {
    const a = makeRng(42), b = makeRng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it('different seeds diverge', () => {
    const a = makeRng(1), b = makeRng(2);
    const seqA = Array.from({ length: 8 }, () => a.next());
    const seqB = Array.from({ length: 8 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });
  it('outputs stay in [0, 1) and helpers respect ranges', () => {
    const r = makeRng(7);
    for (let i = 0; i < 200; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = r.int(2, 5);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
  });
  it('hash2 is deterministic and order-sensitive', () => {
    expect(hash2(3, 99)).toBe(hash2(3, 99));
    expect(hash2(3, 99)).not.toBe(hash2(99, 3));
  });
  it('same seed → identical chunk spawn plan (layout determinism)', () => {
    // reproduce the spawner's planning walk twice with the same seed
    const plan = (seed) => {
      const rng = makeRng(hash2(8, seed));
      const out = [];
      let s = 400;
      const counts = {};
      while (s < 450) {
        const options = eligibleTypes(s, counts);
        const e = pickWeighted(options, rng.next());
        out.push([e.type, Math.round(s * 100)]);
        counts[e.type] = (counts[e.type] || 0) + 1;
        s += spawnSpacing(s) * rng.range(0.75, 1.35);
      }
      return out;
    };
    expect(plan(1234)).toEqual(plan(1234));
    expect(plan(1234)).not.toEqual(plan(999));
  });
});
