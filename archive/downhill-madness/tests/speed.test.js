import { describe, it, expect } from 'vitest';
import {
  speedAt, currentSpeed, stumbleFactor, lateralSpeed,
  START_SPEED, MAX_SPEED, MIN_SPEED, STUMBLE_DURATION,
} from '../src/player/speed.js';
import { speedAtDistance } from '../src/obstacles/fairness.js';

describe('speed ramp (spec §4.1)', () => {
  it('starts at 7 m/s', () => {
    expect(speedAt(0)).toBe(START_SPEED);
  });
  it('ramps +0.28 m/s per second', () => {
    expect(speedAt(30)).toBeCloseTo(7 + 0.28 * 30);
    expect(speedAt(60)).toBeCloseTo(7 + 0.28 * 60);
  });
  it('caps at 30 m/s', () => {
    expect(speedAt(120)).toBe(MAX_SPEED);
    expect(speedAt(10000)).toBe(MAX_SPEED);
  });
  it('never drops below the floor', () => {
    expect(currentSpeed(0, 0, 0.1)).toBeGreaterThanOrEqual(MIN_SPEED);
  });
});

describe('stumble (spec §4.4)', () => {
  it('drops speed 30% at impact', () => {
    expect(stumbleFactor(0)).toBeCloseTo(0.7);
  });
  it('recovers fully after 0.8 s', () => {
    expect(stumbleFactor(STUMBLE_DURATION)).toBe(1);
    expect(stumbleFactor(0.4)).toBeGreaterThan(0.7);
    expect(stumbleFactor(0.4)).toBeLessThan(1);
  });
});

describe('lateral speed (spec §4.2)', () => {
  it('scales at 0.45× forward, clamped to [4, 11]', () => {
    expect(lateralSpeed(7)).toBeCloseTo(4);
    expect(lateralSpeed(20)).toBeCloseTo(9);
    expect(lateralSpeed(30)).toBe(11);
    expect(lateralSpeed(1)).toBe(4);
  });
});

describe('speedAtDistance (fairness helper)', () => {
  it('matches v² = v0² + 2as and caps at 30', () => {
    expect(speedAtDistance(0)).toBeCloseTo(7);
    expect(speedAtDistance(100)).toBeCloseTo(Math.sqrt(49 + 56));
    expect(speedAtDistance(99999)).toBe(30);
  });
});
