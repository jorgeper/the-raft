// U1 — SPEC §2.3: swing outcome is a pure function of timing offset + pitch type,
// resolved with the seeded PRNG. Asserts each timing band and the outcome
// distribution under a fixed seed.
import { describe, it, expect } from 'vitest';
import { resolveSwing, POWER_SET, CONTACT_SET } from '../../src/engine/resolve';
import { mulberry32 } from '../../src/engine/prng';

describe('U1: swing resolution bands', () => {
  it('|offset| <= 40 lands in the power set', () => {
    const rng = mulberry32(1);
    for (const off of [0, 12, -25, 40, -40]) {
      expect(POWER_SET).toContain(resolveSwing(off, 'fastball', rng));
    }
  });

  it('40 < |offset| <= 90 lands in the contact set', () => {
    const rng = mulberry32(2);
    for (const off of [41, -55, 72, 90, -90]) {
      expect(CONTACT_SET).toContain(resolveSwing(off, 'curve', rng));
    }
  });

  it('90 < |offset| <= 140 is a foul', () => {
    const rng = mulberry32(3);
    for (const off of [91, -100, 120, 140, -140]) {
      expect(resolveSwing(off, 'changeup', rng)).toBe('foul');
    }
  });

  it('|offset| > 140 or no swing is a strike', () => {
    const rng = mulberry32(4);
    expect(resolveSwing(141, 'fastball', rng)).toBe('strike');
    expect(resolveSwing(-500, 'curve', rng)).toBe('strike');
    expect(resolveSwing(null, 'changeup', rng)).toBe('strike');
  });

  it('power-band distribution under a fixed seed: HR 30%, triple 10%, double 30%, single 30%', () => {
    const rng = mulberry32(42);
    const counts: Record<string, number> = {};
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const o = resolveSwing(0, 'fastball', rng);
      counts[o] = (counts[o] ?? 0) + 1;
    }
    expect((counts['homerun'] ?? 0) / N).toBeCloseTo(0.3, 1);
    expect((counts['triple'] ?? 0) / N).toBeCloseTo(0.1, 1);
    expect((counts['double'] ?? 0) / N).toBeCloseTo(0.3, 1);
    expect((counts['single'] ?? 0) / N).toBeCloseTo(0.3, 1);
    expect(Object.keys(counts).sort()).toEqual(['double', 'homerun', 'single', 'triple']);
  });

  it('contact-band distribution under a fixed seed: single 45%, double 15%, flyout 25%, groundout 15%', () => {
    const rng = mulberry32(43);
    const counts: Record<string, number> = {};
    const N = 4000;
    for (let i = 0; i < N; i++) {
      const o = resolveSwing(70, 'fastball', rng);
      counts[o] = (counts[o] ?? 0) + 1;
    }
    expect((counts['single'] ?? 0) / N).toBeCloseTo(0.45, 1);
    expect((counts['double'] ?? 0) / N).toBeCloseTo(0.15, 1);
    expect((counts['flyout'] ?? 0) / N).toBeCloseTo(0.25, 1);
    expect((counts['groundout'] ?? 0) / N).toBeCloseTo(0.15, 1);
  });
});
