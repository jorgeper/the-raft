// U5 — SPEC §2.2: no balls or walks; a miss or taken pitch is a strike,
// 3 strikes is an out, a foul is a strike but never the third.
import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/game';
import type { Outcome } from '../../src/engine/resolve';

function force(game: ReturnType<typeof createGame>, outcomes: Outcome[]) {
  for (const o of outcomes) {
    game.dispatch({ type: 'pitch', pitch: 'fastball', lane: 0 });
    game.dispatch({ type: 'forceOutcome', outcome: o });
  }
}

describe('U5: strikes, fouls, outs', () => {
  it('a taken pitch (cross, no swing) is a strike', () => {
    const g = createGame(1);
    g.dispatch({ type: 'start', mode: '2p' });
    g.dispatch({ type: 'pitch', pitch: 'fastball', lane: 0 });
    g.dispatch({ type: 'cross' });
    expect(g.state.strikes).toBe(1);
  });

  it('three strikes make an out and reset the count', () => {
    const g = createGame(1);
    g.dispatch({ type: 'start', mode: '2p' });
    force(g, ['strike', 'strike', 'strike']);
    expect(g.state.outs).toBe(1);
    expect(g.state.strikes).toBe(0);
  });

  it('fouls count as strikes but never the third', () => {
    const g = createGame(1);
    g.dispatch({ type: 'start', mode: '2p' });
    force(g, ['foul']);
    expect(g.state.strikes).toBe(1);
    force(g, ['foul']);
    expect(g.state.strikes).toBe(2);
    force(g, ['foul', 'foul', 'foul']);
    expect(g.state.strikes).toBe(2); // stuck at two
    expect(g.state.outs).toBe(0);
    force(g, ['strike']);
    expect(g.state.outs).toBe(1);
  });

  it('a hit resets the strike count', () => {
    const g = createGame(1);
    g.dispatch({ type: 'start', mode: '2p' });
    force(g, ['strike', 'foul', 'single']);
    expect(g.state.strikes).toBe(0);
    expect(g.state.bases).toEqual([true, false, false]);
  });
});
