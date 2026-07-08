import type { GameState } from './engine/game';
import type { PitchType } from './engine/resolve';

const $ = (id: string) => document.getElementById(id)!;

const BANNER_TEXT: Record<string, string> = {
  homerun: 'HOME RUN!',
  triple: 'TRIPLE!',
  double: 'DOUBLE!',
  single: 'BASE HIT!',
  flyout: 'OUT!',
  groundout: 'OUT!',
  strike: 'STRIKE!',
  foul: 'FOUL!',
  sideRetired: 'SIDE RETIRED',
};

export interface Hud {
  sync(state: GameState, humanPitching: boolean, humanBatting: boolean): void;
  showBanner(event: string): void;
  setPitchSelection(pitch: PitchType, lane: number): void;
  tick(now: number): void;
}

/** DOM scoreboard + banners (SPEC §6). Pure view over engine state. */
export function buildHud(): Hud {
  let bannerUntil = 0;

  return {
    sync(state, humanPitching, humanBatting) {
      const inPlay = state.phase === 'awaitPitch' || state.phase === 'ballInFlight';
      $('title-screen').hidden = state.phase !== 'title';
      $('scoreboard').hidden = !inPlay && state.phase !== 'gameOver';
      $('gameover').hidden = state.phase !== 'gameOver';

      if (inPlay || state.phase === 'gameOver') {
        $('sb-inning').textContent = `${state.half === 'top' ? '▲' : '▼'} ${state.inning}`;
        $('sb-away').textContent = String(state.scores.away);
        $('sb-home').textContent = String(state.scores.home);
        $('sb-outs').textContent = `OUT ${'●'.repeat(state.outs)}${'○'.repeat(Math.max(0, 3 - state.outs))}`;
        $('sb-strikes').textContent = `STK ${'●'.repeat(state.strikes)}${'○'.repeat(Math.max(0, 3 - state.strikes))}`;
        $('sb-mute').textContent = state.muted ? '🔇' : '🔊';
      }

      if (state.phase === 'gameOver' && state.winner) {
        $('gameover-text').textContent = `GAME OVER — ${state.winner.toUpperCase()} WINS`;
      }

      $('pitch-ui').hidden = !(state.phase === 'awaitPitch' && humanPitching);
      $('bat-ui').hidden = !(state.phase === 'ballInFlight' && humanBatting);

      const role = $('role-banner');
      if (!inPlay || state.mode === null) {
        role.hidden = true;
      } else if (state.mode === '2p') {
        const batterP = state.batting === 'away' ? 'P1' : 'P2';
        const pitcherP = state.batting === 'away' ? 'P2' : 'P1';
        role.hidden = false;
        role.textContent = `${batterP} BATS (SPACE) · ${pitcherP} PITCHES (1/2/3 + ENTER)`;
      } else {
        role.hidden = false;
        role.textContent = humanBatting ? "YOU'RE BATTING — SPACE TO SWING" : "YOU'RE PITCHING — 1/2/3, ◀▶, ENTER";
      }
    },

    showBanner(event) {
      const text = BANNER_TEXT[event];
      if (!text) return;
      const b = $('banner');
      b.textContent = text;
      b.hidden = false;
      bannerUntil = performance.now() + 1400;
    },

    setPitchSelection(pitch, lane) {
      $('pitch-type').textContent = pitch.toUpperCase();
      $('pitch-lane').textContent = lane === 0 ? 'MIDDLE' : lane < 0 ? '◀ INSIDE' : 'OUTSIDE ▶';
    },

    tick(now) {
      if (bannerUntil && now > bannerUntil) {
        $('banner').hidden = true;
        bannerUntil = 0;
      }
    },
  };
}
