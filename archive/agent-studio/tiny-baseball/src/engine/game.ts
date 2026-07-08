import { mulberry32 } from './prng';
import { resolveSwing, FLIGHT_MS } from './resolve';
import type { Outcome, PitchType, Lane } from './resolve';

export type Mode = '1p' | '2p';
export type Side = 'away' | 'home';
export type Phase = 'title' | 'awaitPitch' | 'ballInFlight' | 'gameOver';

export interface PitchInFlight {
  pitch: PitchType;
  lane: Lane;
}

export interface GameState {
  phase: Phase;
  mode: Mode | null;
  inning: number;
  half: 'top' | 'bottom';
  batting: Side;
  outs: number;
  strikes: number;
  bases: [boolean, boolean, boolean];
  scores: { away: number; home: number };
  pitch: PitchInFlight | null;
  /** Last resolved event, for HUD banners and crowd/audio reactions. */
  lastEvent: Outcome | 'sideRetired' | null;
  winner: Side | null;
  muted: boolean;
}

export type Action =
  | { type: 'start'; mode: Mode }
  | { type: 'pitch'; pitch: PitchType; lane: Lane }
  | { type: 'swing'; offsetMs: number }
  | { type: 'cross' } // ball crossed the plate, no swing
  | { type: 'forceOutcome'; outcome: Outcome } // test hook: bypass the RNG
  | { type: 'rematch' }
  | { type: 'setMuted'; muted: boolean };

const INNINGS = 3;

function freshState(muted = false): GameState {
  return {
    phase: 'title',
    mode: null,
    inning: 1,
    half: 'top',
    batting: 'away',
    outs: 0,
    strikes: 0,
    bases: [false, false, false],
    scores: { away: 0, home: 0 },
    pitch: null,
    lastEvent: null,
    winner: null,
    muted,
  };
}

const HIT_BASES: Partial<Record<Outcome, number>> = {
  single: 1,
  double: 2,
  triple: 3,
  homerun: 4,
};

export interface Game {
  readonly state: GameState;
  readonly seed: number;
  dispatch(action: Action): GameState;
}

export function createGame(seed: number): Game {
  const rng = mulberry32(seed);
  let s = freshState();

  function advanceRunners(n: number) {
    // Shift the bases array by n with the batter entering at base n-1;
    // every runner pushed past third scores.
    const lineup = [true, ...s.bases]; // [batter, 1st, 2nd, 3rd]
    const next: boolean[] = [false, false, false];
    let runs = 0;
    for (let base = 3; base >= 0; base--) {
      if (!lineup[base]) continue;
      const dest = base + n;
      if (dest >= 4) runs++;
      else next[dest - 1] = true;
    }
    s.bases = [next[0], next[1], next[2]];
    s.scores[s.batting] += runs;
  }

  function endHalf() {
    s.outs = 0;
    s.strikes = 0;
    s.bases = [false, false, false];
    if (s.half === 'top') {
      // Skip the bottom when the home team already leads in the final or an
      // extra inning (SPEC §2.1).
      if (s.inning >= INNINGS && s.scores.home > s.scores.away) {
        return endGame('home');
      }
      s.half = 'bottom';
      s.batting = 'home';
    } else {
      if (s.inning >= INNINGS && s.scores.home !== s.scores.away) {
        return endGame(s.scores.home > s.scores.away ? 'home' : 'away');
      }
      s.inning++;
      s.half = 'top';
      s.batting = 'away';
    }
    s.lastEvent = 'sideRetired';
  }

  function endGame(winner: Side) {
    s.phase = 'gameOver';
    s.winner = winner;
    s.pitch = null;
  }

  function applyOutcome(outcome: Outcome) {
    s.lastEvent = outcome;
    s.pitch = null;
    s.phase = 'awaitPitch';

    const basesGained = HIT_BASES[outcome];
    if (basesGained !== undefined) {
      s.strikes = 0;
      advanceRunners(basesGained);
      // Walk-off: home taking the lead while batting in the bottom of the
      // final (or an extra) inning ends the game on the spot.
      if (
        s.half === 'bottom' &&
        s.inning >= INNINGS &&
        s.scores.home > s.scores.away
      ) {
        return endGame('home');
      }
      return;
    }

    if (outcome === 'foul') {
      s.strikes = Math.min(s.strikes + 1, 2);
      return;
    }
    if (outcome === 'strike') {
      s.strikes++;
      if (s.strikes < 3) return;
      // strikeout falls through as an out
    }
    // flyout, groundout, strikeout
    s.strikes = 0;
    s.outs++;
    if (s.outs >= 3) endHalf();
  }

  function dispatch(action: Action): GameState {
    switch (action.type) {
      case 'start':
        if (s.phase !== 'title') break;
        s = freshState(s.muted);
        s.phase = 'awaitPitch';
        s.mode = action.mode;
        break;
      case 'pitch':
        if (s.phase !== 'awaitPitch') break;
        s.pitch = { pitch: action.pitch, lane: action.lane };
        s.phase = 'ballInFlight';
        break;
      case 'swing':
        if (s.phase !== 'ballInFlight' || !s.pitch) break;
        applyOutcome(resolveSwing(action.offsetMs, s.pitch.pitch, rng));
        break;
      case 'cross':
        if (s.phase !== 'ballInFlight' || !s.pitch) break;
        applyOutcome(resolveSwing(null, s.pitch.pitch, rng));
        break;
      case 'forceOutcome':
        if (s.phase !== 'ballInFlight' || !s.pitch) break;
        applyOutcome(action.outcome);
        break;
      case 'rematch':
        if (s.phase !== 'gameOver') break;
        s = freshState(s.muted);
        break;
      case 'setMuted':
        s.muted = action.muted;
        break;
    }
    return s;
  }

  return {
    get state() {
      return s;
    },
    seed,
    dispatch,
  };
}

const PITCHES: PitchType[] = ['fastball', 'curve', 'changeup'];
const LANES: Lane[] = [-1, 0, 1];

/**
 * SPEC §1.3 — headlessly simulate an entire game from a seed: random pitches,
 * random swing offsets. Deterministic per seed; always terminates because
 * every at-bat ends in a bounded number of pitches (fouls cap at 2 strikes but
 * the offset distribution hits every band with positive probability).
 */
export function ffwd(seed: number): GameState {
  return simulateGame(seed).state;
}

/** Like ffwd but returns the live Game so a UI can keep dispatching
 * (e.g. rematch) after the simulated game ends. */
export function simulateGame(seed: number): Game {
  const g = createGame(seed);
  const rng = mulberry32(seed ^ 0x9e3779b9);
  g.dispatch({ type: 'start', mode: '2p' });
  let guard = 100_000;
  while (g.state.phase !== 'gameOver' && guard-- > 0) {
    g.dispatch({
      type: 'pitch',
      pitch: PITCHES[Math.floor(rng() * 3)],
      lane: LANES[Math.floor(rng() * 3)],
    });
    g.dispatch({ type: 'swing', offsetMs: rng() * 400 - 200 });
  }
  return g;
}

export { FLIGHT_MS };
