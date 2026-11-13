import { describe, it, expect } from 'vitest';
import { createStyleDetector } from '../src/scoring/style.js';

const solid = (s, l, hl = 0.5, hy = 1, y = 1) => ({ s, l, y, hs: 0.5, hl, hy, kind: 'solid' });
const player = (s, l = 0, footY = 0) => ({ s, l, footY });

describe('near-miss & threading detection (spec §4.5)', () => {
  it('awards a near-miss for a tight lateral pass', () => {
    const d = createStyleDetector();
    const inst = { boxes: [solid(100, 1.2)] }; // gap = 1.2 - 0.5 - 0.35 = 0.35 < 0.5
    expect(d.detectPasses([inst], player(98), false)).toEqual([]);
    const events = d.detectPasses([inst], player(101), false);
    expect(events).toEqual([{ kind: 'nearMiss' }]);
  });
  it('no event for a wide pass', () => {
    const d = createStyleDetector();
    const inst = { boxes: [solid(100, 3.5)] };
    d.detectPasses([inst], player(98), false);
    expect(d.detectPasses([inst], player(101), false)).toEqual([]);
  });
  it('each box fires at most once', () => {
    const d = createStyleDetector();
    const inst = { boxes: [solid(100, 1.2)] };
    d.detectPasses([inst], player(98), false);
    d.detectPasses([inst], player(101), false);
    expect(d.detectPasses([inst], player(104), false)).toEqual([]);
  });
  it('a collision suppresses style for that frame', () => {
    const d = createStyleDetector();
    const inst = { boxes: [solid(100, 1.2)] };
    d.detectPasses([inst], player(98), false);
    expect(d.detectPasses([inst], player(101), true)).toEqual([]);
  });
  it('awards a near-miss for barely clearing a jump', () => {
    const d = createStyleDetector();
    const log = solid(100, 0, 2, 0.45, 0.45); // top at 0.9
    const inst = { boxes: [log] };
    d.detectPasses([inst], player(98, 0, 1.2), false);
    const events = d.detectPasses([inst], player(101, 0, 1.2), false);
    expect(events).toEqual([{ kind: 'nearMiss' }]); // cleared by 0.3 m
  });
  it('awards threading between two tight obstacles', () => {
    const d = createStyleDetector();
    const a = solid(100, -1.5, 0.5);
    const b = solid(100.5, 1.5, 0.5);
    const inst = { boxes: [a, b] };
    d.detectPasses([inst], player(98), false);
    const events = d.detectPasses([inst], player(101.5, 0), false);
    // gap = 1.0 - (-1.0) = 2.0 < 2.5, player between → thread (+ possible near-misses)
    expect(events.some((e) => e.kind === 'thread')).toBe(true);
  });
  it('detects a pass even when the box moves toward the player', () => {
    const d = createStyleDetector();
    const inst = { boxes: [solid(105, 1.2)] };
    d.detectPasses([inst], player(100), false);
    inst.boxes[0].s = 99.5; // biker rode past us
    const events = d.detectPasses([inst], player(100.5), false);
    expect(events).toEqual([{ kind: 'nearMiss' }]);
  });
});
