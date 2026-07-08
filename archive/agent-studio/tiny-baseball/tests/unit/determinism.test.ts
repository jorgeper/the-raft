// U4 — SPEC §1.2: all randomness flows through one seeded PRNG; same seed +
// same input sequence produces an identical final state. Also covers §1.3's
// headless full-game simulation (ffwd).
import { describe, it, expect } from 'vitest';
import { createGame, ffwd } from '../../src/engine/game';

describe('U4: seeded determinism', () => {
  it('ffwd with the same seed yields deep-equal final states', () => {
    const a = ffwd(123);
    const b = ffwd(123);
    expect(a).toEqual(b);
    expect(a.phase).toBe('gameOver');
    expect(a.winner === 'away' || a.winner === 'home').toBe(true);
  });

  it('identical dispatch sequences on the same seed stay identical', () => {
    const mk = () => {
      const g = createGame(7);
      g.dispatch({ type: 'start', mode: '1p' });
      for (let i = 0; i < 20; i++) {
        g.dispatch({ type: 'pitch', pitch: 'curve', lane: 1 });
        g.dispatch({ type: 'swing', offsetMs: (i % 7) * 25 - 75 });
        if (g.state.phase === 'gameOver') break;
      }
      return g.state;
    };
    expect(mk()).toEqual(mk());
  });

  it('ffwd terminates with a winner for many seeds', () => {
    for (const seed of [1, 2, 3, 99, 1234]) {
      const s = ffwd(seed);
      expect(s.phase).toBe('gameOver');
      expect(s.winner).not.toBeNull();
    }
  });
});
