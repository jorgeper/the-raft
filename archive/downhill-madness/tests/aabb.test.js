import { describe, it, expect } from 'vitest';
import { makeBox, overlaps, passesOver, playerBox, expanded } from '../src/utils/aabb.js';

describe('AABB collision (spec §4.4)', () => {
  it('detects overlap and separation on every axis', () => {
    const a = makeBox(10, 0, 0.5, 1, 1, 0.5);
    expect(overlaps(a, makeBox(10.5, 0, 0.5, 1, 1, 0.5))).toBe(true);
    expect(overlaps(a, makeBox(13, 0, 0.5, 1, 1, 0.5))).toBe(false); // ahead
    expect(overlaps(a, makeBox(10, 3, 0.5, 1, 1, 0.5))).toBe(false); // beside
    expect(overlaps(a, makeBox(10, 0, 5, 1, 1, 0.5))).toBe(false); // above
  });
  it('airborne players pass over low obstacles', () => {
    const log = makeBox(10, 0, 0.45, 0.5, 2, 0.45); // top at 0.9 m
    expect(passesOver(1.0, log)).toBe(true);
    expect(passesOver(0.5, log)).toBe(false);
    expect(passesOver(0, log)).toBe(false);
  });
  it('player box matches the 0.6 × 1.7 × 0.6 capsule approximation', () => {
    const p = playerBox(100, 1, 0);
    expect(p.hs).toBeCloseTo(0.3);
    expect(p.hl).toBeCloseTo(0.3);
    expect(p.hy * 2).toBeCloseTo(1.7);
    expect(p.y).toBeCloseTo(0.85);
  });
  it('expanded grows every half-extent', () => {
    const e = expanded(makeBox(0, 0, 0, 1, 1, 1), 0.5);
    expect(e.hs).toBe(1.5);
    expect(e.hl).toBe(1.5);
    expect(e.hy).toBe(1.5);
  });
});
