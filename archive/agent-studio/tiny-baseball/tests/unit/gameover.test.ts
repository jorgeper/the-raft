// U3 — SPEC §2.4: game over declares a winner; a tie after 3 innings plays
// extra innings until one half-inning pair breaks it; walk-off ends the game.
import { describe, it, expect } from 'vitest';
import { createGame } from '../../src/engine/game';
import type { Outcome } from '../../src/engine/resolve';

function force(game: ReturnType<typeof createGame>, outcomes: Outcome[]) {
  for (const o of outcomes) {
    game.dispatch({ type: 'pitch', pitch: 'fastball', lane: 0 });
    game.dispatch({ type: 'forceOutcome', outcome: o });
  }
}

const threeOuts: Outcome[] = ['flyout', 'flyout', 'flyout'];

describe('U3: game over, winner, extra innings', () => {
  it('away leading after bottom 3 wins', () => {
    const g = createGame(1);
    g.dispatch({ type: 'start', mode: '2p' });
    force(g, ['homerun', ...threeOuts]); // top 1: away 1
    for (let i = 0; i < 4; i++) force(g, threeOuts); // bottom 1 .. top 3
    expect(g.state.phase).not.toBe('gameOver'); // bottom 3 must be played
    force(g, threeOuts); // bottom 3
    expect(g.state.phase).toBe('gameOver');
    expect(g.state.winner).toBe('away');
  });

  it('tie after 3 goes to extra innings and resolves', () => {
    const g = createGame(1);
    g.dispatch({ type: 'start', mode: '2p' });
    for (let i = 0; i < 6; i++) force(g, threeOuts); // 3 full innings, 0-0
    expect(g.state.phase).not.toBe('gameOver');
    expect(g.state.inning).toBe(4);
    force(g, ['homerun', ...threeOuts]); // top 4: away 1
    force(g, threeOuts); // bottom 4
    expect(g.state.phase).toBe('gameOver');
    expect(g.state.winner).toBe('away');
  });

  it('home walk-off in the bottom of the 3rd ends the game immediately', () => {
    const g = createGame(1);
    g.dispatch({ type: 'start', mode: '2p' });
    for (let i = 0; i < 5; i++) force(g, threeOuts); // 0-0 entering bottom 3
    force(g, ['homerun']);
    expect(g.state.phase).toBe('gameOver');
    expect(g.state.winner).toBe('home');
  });

  it('rematch returns to a fresh title state', () => {
    const g = createGame(1);
    g.dispatch({ type: 'start', mode: '2p' });
    for (let i = 0; i < 5; i++) force(g, threeOuts);
    force(g, ['homerun']);
    g.dispatch({ type: 'rematch' });
    expect(g.state.phase).toBe('title');
    expect(g.state.scores).toEqual({ away: 0, home: 0 });
    expect(g.state.winner).toBeNull();
  });
});
