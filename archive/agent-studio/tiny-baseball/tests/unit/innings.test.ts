// U2 — SPEC §2.1/§2.4: 3 innings, 3 outs per half, top/bottom order, home bats
// last, bottom of the 3rd not played when home already leads, runs score on
// advances.
import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/game';
import type { Outcome } from '../../src/engine/resolve';

/** Drive the engine with forced outcomes (bypasses the swing RNG). */
function force(game: ReturnType<typeof createGame>, outcomes: Outcome[]) {
  for (const o of outcomes) {
    game.dispatch({ type: 'pitch', pitch: 'fastball', lane: 0 });
    game.dispatch({ type: 'forceOutcome', outcome: o });
  }
}

const threeOuts: Outcome[] = ['flyout', 'flyout', 'flyout'];

describe('U2: innings, outs, half switching', () => {
  it('starts at top 1, away batting, 0 outs', () => {
    const g = createGame(1);
    g.dispatch({ type: 'start', mode: '2p' });
    expect(g.state.inning).toBe(1);
    expect(g.state.half).toBe('top');
    expect(g.state.batting).toBe('away');
    expect(g.state.outs).toBe(0);
  });

  it('3 outs retire the side; bases and counts reset; half flips', () => {
    const g = createGame(1);
    g.dispatch({ type: 'start', mode: '2p' });
    force(g, ['single', 'flyout', 'flyout', 'flyout']);
    expect(g.state.half).toBe('bottom');
    expect(g.state.batting).toBe('home');
    expect(g.state.outs).toBe(0);
    expect(g.state.strikes).toBe(0);
    expect(g.state.bases).toEqual([false, false, false]);
    expect(g.state.inning).toBe(1);
  });

  it('bottom half retiring advances the inning', () => {
    const g = createGame(1);
    g.dispatch({ type: 'start', mode: '2p' });
    force(g, [...threeOuts, ...threeOuts]);
    expect(g.state.inning).toBe(2);
    expect(g.state.half).toBe('top');
  });

  it('hits advance runners and score runs: single, single, homerun = 3 runs', () => {
    const g = createGame(1);
    g.dispatch({ type: 'start', mode: '2p' });
    force(g, ['single', 'single', 'homerun']);
    expect(g.state.scores.away).toBe(3);
    expect(g.state.bases).toEqual([false, false, false]);
  });

  it('triple then groundout scores no run (runners hold on outs)', () => {
    const g = createGame(1);
    g.dispatch({ type: 'start', mode: '2p' });
    force(g, ['triple', 'groundout']);
    expect(g.state.scores.away).toBe(0);
    expect(g.state.bases).toEqual([false, false, true]);
    expect(g.state.outs).toBe(1);
  });

  it('does not play the bottom of the 3rd when home already leads', () => {
    const g = createGame(1);
    g.dispatch({ type: 'start', mode: '2p' });
    // top1: away 0. bottom1: home hits a HR then 3 outs.
    force(g, threeOuts);
    force(g, ['homerun', ...threeOuts]);
    // innings 2 and 3 tops/bottoms all outs; after top 3 home leads 1-0.
    force(g, threeOuts); // top 2
    force(g, threeOuts); // bottom 2
    force(g, threeOuts); // top 3
    expect(g.state.phase).toBe('gameOver');
    expect(g.state.winner).toBe('home');
  });
});
