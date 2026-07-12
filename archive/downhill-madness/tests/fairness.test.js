import { describe, it, expect } from 'vitest';
import { verifyPattern } from '../src/obstacles/fairness.js';

const wall = (s, jumpable = false) => ({ s, hs: 0.5, l: 0, hl: 4.2, jumpable });

describe('fairness verifier (spec §6.2)', () => {
  it('accepts an empty chunk', () => {
    expect(verifyPattern([])).toBe(true);
  });
  it('accepts a single obstacle with room to steer', () => {
    expect(verifyPattern([{ s: 100, hs: 0.5, l: 0, hl: 1, jumpable: false }])).toBe(true);
  });
  it('rejects an unjumpable full-width wall', () => {
    expect(verifyPattern([wall(100)])).toBe(false);
  });
  it('accepts a jumpable full-width wall', () => {
    expect(verifyPattern([wall(100, true)])).toBe(true);
  });
  it('rejects two full-width jumps closer than a jump cycle', () => {
    // separate clusters 6 m apart: can't land and jump again in time
    expect(verifyPattern([wall(300, true), wall(306, true)])).toBe(false);
  });
  it('rejects a jumpable span too long for one jump arc', () => {
    // 12 m of contiguous jumpable blockage exceeds any jump arc
    expect(verifyPattern([
      { s: 300, hs: 3, l: 0, hl: 4.2, jumpable: true },
      { s: 303, hs: 3, l: 0, hl: 4.2, jumpable: true },
    ])).toBe(false);
  });
  it('accepts two full-width jumps spaced beyond a jump cycle', () => {
    expect(verifyPattern([wall(300, true), wall(340, true)])).toBe(true);
  });
  it('rejects an unreachable gap switch', () => {
    // gap hard left, then 2 m later gap hard right — cannot steer 6+ m in 2 m
    const a = { s: 100, hs: 0.5, l: 1.2, hl: 2.8, jumpable: false }; // gap at left
    const b = { s: 102, hs: 0.5, l: -1.2, hl: 2.8, jumpable: false }; // gap at right
    expect(verifyPattern([a, b])).toBe(false);
  });
  it('accepts the same switch with distance to steer', () => {
    const a = { s: 100, hs: 0.5, l: 1.2, hl: 2.8, jumpable: false };
    const b = { s: 130, hs: 0.5, l: -1.2, hl: 2.8, jumpable: false };
    expect(verifyPattern([a, b])).toBe(true);
  });
  it('rejects a corridor pinched below the minimum gap', () => {
    const left = { s: 100, hs: 0.5, l: -2.6, hl: 2.2, jumpable: false };
    const right = { s: 100, hs: 0.5, l: 2.6, hl: 2.2, jumpable: false };
    // free space is (-0.4..0.4) minus player margin -> too tight
    expect(verifyPattern([left, right])).toBe(false);
  });
  it('accepts a corridor with a survivable gap', () => {
    const left = { s: 100, hs: 0.5, l: -3, hl: 2, jumpable: false };
    const right = { s: 100, hs: 0.5, l: 3, hl: 2, jumpable: false };
    expect(verifyPattern([left, right])).toBe(true);
  });
});
