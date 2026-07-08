import * as THREE from 'three';
import { createGame, simulateGame, FLIGHT_MS } from './engine/game';
import type { Action, Game, GameState } from './engine/game';
import type { Lane, Outcome, PitchType } from './engine/resolve';
import { buildWorld, buildStands } from './render/scene';
import { buildCast, idleBob } from './render/players';
import { buildCrowd } from './render/crowd';
import { buildBall } from './render/ball';
import { buildHud } from './hud';
import { buildSound } from './audio';

const MUTE_KEY = 'tb-muted';
const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') ?? 20260707);

// --- three.js setup: render at chunky low res, upscale with CSS (SPEC §4.1)
const renderer = new THREE.WebGLRenderer({ antialias: false });
document.getElementById('app')!.appendChild(renderer.domElement);
const world = buildWorld();
const seats = buildStands(world.scene);
const crowd = buildCrowd(world.scene, seats);
const cast = buildCast(world.scene);
const ball = buildBall(world.scene);
const hud = buildHud();
const sound = buildSound(localStorage.getItem(MUTE_KEY) === '1');

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const lowW = Math.min(640, Math.max(240, Math.floor(w / 3)));
  const lowH = Math.max(160, Math.floor(lowW * (h / w)));
  renderer.setSize(lowW, lowH, false);
  world.camera.aspect = w / h;
  world.camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// --- game + controller state
let game: Game = createGame(SEED);
game.dispatch({ type: 'setMuted', muted: localStorage.getItem(MUTE_KEY) === '1' });

let plateAt = 0; // when the current pitch crosses the plate
let swung = false;
let cooldownUntil = 0; // gate between plays so banners/animations can breathe
let cpuPitchAt = 0;
let cpuSwingAt = 0;
let cpuSwingOffset = 0;
let selPitch: PitchType = 'fastball';
let selLane: Lane = 0;
let swingAnimUntil = 0;

const HITS: Outcome[] = ['single', 'double', 'triple', 'homerun'];
const CONTACT: Outcome[] = [...HITS, 'flyout', 'groundout', 'foul'];

/** Is the human holding the bat / the ball right now? (1P: human is AWAY.) */
function humanBatting(s: GameState): boolean {
  return s.mode === '2p' || s.batting === 'away';
}
function humanPitching(s: GameState): boolean {
  return s.mode === '2p' || s.batting === 'home';
}

/** Single funnel for all actions (keyboard, CPU, tests) so FX stay in sync. */
function act(action: Action): GameState {
  const before = game.state.phase;
  const s = game.dispatch(action);
  if (action.type === 'pitch' && s.phase === 'ballInFlight') {
    const flight = FLIGHT_MS[action.pitch];
    plateAt = performance.now() + flight;
    swung = false;
    ball.throwPitch(action.pitch, action.lane, flight);
    if (s.mode === '1p' && !humanBatting(s)) {
      // CPU batter: seeded-ish competence — swings 80% of the time, offset
      // spread wide enough to produce hits, fouls, and whiffs.
      if (Math.random() < 0.8) {
        cpuSwingOffset = (Math.random() + Math.random() - 1) * 130;
        cpuSwingAt = plateAt + cpuSwingOffset;
      } else {
        cpuSwingAt = 0;
      }
    }
  }
  if (
    (action.type === 'swing' || action.type === 'cross' || action.type === 'forceOutcome') &&
    before === 'ballInFlight' &&
    s.phase !== 'ballInFlight'
  ) {
    onOutcome(s);
  }
  return s;
}

function onOutcome(s: GameState): void {
  const ev = s.lastEvent;
  if (!ev) return;
  hud.showBanner(s.phase === 'gameOver' ? (ev === 'sideRetired' ? 'strike' : ev) : ev);
  const visual: Outcome = ev === 'sideRetired' ? 'flyout' : (ev as Outcome);
  ball.resolve(visual);
  if (CONTACT.includes(visual)) {
    sound.crack();
    swingAnimUntil = performance.now() + 300;
  } else {
    sound.pop();
  }
  if (HITS.includes(visual)) {
    const big = visual === 'homerun';
    sound.cheer(big);
    if (big) {
      crowd.bigCheer();
      crowd.confettiBurst();
    } else {
      crowd.cheer();
    }
  }
  cooldownUntil = performance.now() + 1400;
  cpuSwingAt = 0;
  cpuPitchAt = 0;
}

function toggleMute(): void {
  const muted = !game.state.muted;
  game.dispatch({ type: 'setMuted', muted });
  sound.setMuted(muted);
  localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
}

// --- input
document.getElementById('btn-1p')!.addEventListener('click', () => act({ type: 'start', mode: '1p' }));
document.getElementById('btn-2p')!.addEventListener('click', () => act({ type: 'start', mode: '2p' }));
document.getElementById('btn-rematch')!.addEventListener('click', () => act({ type: 'rematch' }));
window.addEventListener('pointerdown', () => sound.unlock());

window.addEventListener('keydown', (e) => {
  sound.unlock();
  const s = game.state;
  const now = performance.now();
  if (e.key === 'm' || e.key === 'M') return toggleMute();

  if (s.phase === 'title') {
    if (e.key === '1') act({ type: 'start', mode: '1p' });
    if (e.key === '2') act({ type: 'start', mode: '2p' });
    return;
  }
  if (s.phase === 'gameOver') {
    if (e.key === 'Enter') act({ type: 'rematch' });
    return;
  }
  if (s.phase === 'awaitPitch' && humanPitching(s) && now > cooldownUntil) {
    if (e.key === '1') selPitch = 'fastball';
    if (e.key === '2') selPitch = 'curve';
    if (e.key === '3') selPitch = 'changeup';
    if (e.key === 'ArrowLeft') selLane = Math.max(-1, selLane - 1) as Lane;
    if (e.key === 'ArrowRight') selLane = Math.min(1, selLane + 1) as Lane;
    if (e.key === 'Enter') act({ type: 'pitch', pitch: selPitch, lane: selLane });
  }
  if (s.phase === 'ballInFlight' && humanBatting(s) && e.key === ' ' && !swung) {
    swung = true;
    swingAnimUntil = now + 300;
    act({ type: 'swing', offsetMs: now - plateAt });
  }
});

// --- test hook (SPEC §1.3): drive or fast-forward the live game headlessly
declare global {
  interface Window {
    __game: {
      readonly state: GameState;
      dispatch(action: Action): GameState;
      ffwd(seed: number): GameState;
    };
  }
}
window.__game = {
  get state() {
    return game.state;
  },
  dispatch: (a) => act(a),
  ffwd(seed: number) {
    game = simulateGame(seed);
    return game.state;
  },
};

// --- CPU turns + per-frame sim
function driveCpu(now: number): void {
  const s = game.state;
  if (s.mode !== '1p' || s.phase === 'title' || s.phase === 'gameOver') return;
  if (s.phase === 'awaitPitch' && !humanPitching(s) && now > cooldownUntil) {
    if (!cpuPitchAt) cpuPitchAt = now + 900 + Math.random() * 700;
    if (now >= cpuPitchAt) {
      cpuPitchAt = 0;
      const pitches: PitchType[] = ['fastball', 'curve', 'changeup'];
      act({
        type: 'pitch',
        pitch: pitches[Math.floor(Math.random() * 3)],
        lane: [-1, 0, 1][Math.floor(Math.random() * 3)] as Lane,
      });
    }
  }
  if (s.phase === 'ballInFlight' && !humanBatting(s) && cpuSwingAt && now >= cpuSwingAt) {
    cpuSwingAt = 0;
    act({ type: 'swing', offsetMs: cpuSwingOffset });
  }
}

let last = performance.now();
function frame(): void {
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  const s = game.state;

  driveCpu(now);

  // Missed pitch that nobody swung at
  if (s.phase === 'ballInFlight' && now > plateAt + 160 && !swung && (s.mode === '2p' || humanBatting(s))) {
    act({ type: 'cross' });
  }

  // world animation
  for (const cloud of world.clouds) {
    cloud.position.x += dt * 0.6;
    if (cloud.position.x > 80) cloud.position.x = -80;
  }
  idleBob(cast, t);
  cast.batter.rotation.y = -Math.PI / 2 + (now < swingAnimUntil ? Math.sin(((swingAnimUntil - now) / 300) * Math.PI) * -1.6 : 0);
  for (let i = 0; i < 3; i++) cast.runners[i].visible = s.bases[i];
  crowd.update(t, dt);
  ball.update(dt);

  hud.setPitchSelection(selPitch, selLane);
  hud.sync(s, humanPitching(s), humanBatting(s));
  hud.tick(now);

  renderer.render(world.scene, world.camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
