import { describe, it, expect } from 'vitest';
import { createScore, createBestStore, spinPoints, airPoints, POINTS } from '../src/scoring/score.js';

describe('style points (spec §4.5)', () => {
  it('spins stack: 250, +500, +750…', () => {
    expect(spinPoints(1)).toBe(250);
    expect(spinPoints(2)).toBe(750);
    expect(spinPoints(3)).toBe(1500);
    expect(spinPoints(0)).toBe(0);
  });
  it('air time pays 30/s, ×2 off ramps', () => {
    expect(airPoints(1, false)).toBe(30);
    expect(airPoints(2.5, false)).toBe(75);
    expect(airPoints(1, true)).toBe(60);
  });
});

describe('combo (spec §4.5)', () => {
  it('three events within 3 s multiply the window ×1.5', () => {
    const s = createScore();
    s.addStyle(1.0, 'CLOSE!', 50);
    s.addStyle(2.0, 'CLOSE!', 50);
    const r = s.addStyle(3.5, 'THREADED!', 100);
    expect(r.comboBonus).toBe(100); // (50+50+100) * 0.5
    expect(s.state.style).toBe(300);
  });
  it('events spread beyond 3 s never combo', () => {
    const s = createScore();
    s.addStyle(1, 'CLOSE!', 50);
    s.addStyle(5, 'CLOSE!', 50);
    const r = s.addStyle(9, 'CLOSE!', 50);
    expect(r.comboBonus).toBe(0);
  });
  it('total = floor(distance) + style', () => {
    const s = createScore();
    s.setDistance(123.9);
    s.addStyle(1, 'CLOSE!', POINTS.nearMiss);
    expect(s.total()).toBe(123 + 50);
  });
  it('breakdown groups by label', () => {
    const s = createScore();
    s.addStyle(1, 'CLOSE!', 50);
    s.addStyle(10, 'CLOSE!', 50);
    s.addStyle(20, 'SPIN!', 250);
    const b = s.breakdown();
    expect(b.find((x) => x.label === 'CLOSE!')).toEqual({ label: 'CLOSE!', count: 2, pts: 100 });
    expect(b.find((x) => x.label === 'SPIN!').pts).toBe(250);
  });
});

describe('best store (spec §4.5 persistence)', () => {
  const mockStorage = () => {
    const m = new Map();
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  };
  it('round-trips and only overwrites on improvement', () => {
    const store = createBestStore(mockStorage());
    expect(store.get()).toEqual({ score: 0, distance: 0 });
    expect(store.submit(500, 400)).toBe(true);
    expect(store.get()).toEqual({ score: 500, distance: 400 });
    expect(store.submit(300, 250)).toBe(false);
    expect(store.get().score).toBe(500);
  });
  it('survives corrupted storage', () => {
    const store = createBestStore({ getItem: () => '{bad json', setItem: () => {} });
    expect(store.get()).toEqual({ score: 0, distance: 0 });
  });
});
