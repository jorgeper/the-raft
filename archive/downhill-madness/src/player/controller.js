import { clamp, TAU } from '../utils/math.js';
import {
  currentSpeed, lateralSpeed, JUMP_VELOCITY, GRAVITY,
  RAMP_JUMP_MULT, RAMP_AUTO_MULT, STUMBLE_DURATION,
} from './speed.js';
import { TRAIL_HALF_WIDTH } from '../world/trail.js';

// Player simulation in track space: s forward, l lateral, footY above ground.
// States: running | airborne | crashed. Emits events for scoring/audio/fx.

const SPIN_TIME = 0.6; // seconds per full rotation (spec §4.5)
const SPIN_LANDING_TOLERANCE = 0.55; // radians from upright that still counts

export function createController(events = {}) {
  const p = {
    state: 'running',
    s: 0, l: 0, footY: 0, vy: 0,
    runTime: 0,
    stumbleAge: Infinity,
    softHitCooldown: 0,
    dragFactor: 1, // mud etc, reset each tick by obstacle effects
    edgeGrind: 0,
    // spin trick
    spinning: false, spinAngle: 0, spinsDone: 0,
    // air style
    airTime: 0, rampLaunched: false,
    // width restriction (cliff narrows)
    halfWidth: TRAIL_HALF_WIDTH,
    speed: 0, steer: 0,
    crashReason: null,
  };

  function reset() {
    Object.assign(p, {
      state: 'running', s: 0, l: 0, footY: 0, vy: 0, runTime: 0,
      stumbleAge: Infinity, softHitCooldown: 0, dragFactor: 1, edgeGrind: 0,
      spinning: false, spinAngle: 0, spinsDone: 0, airTime: 0,
      rampLaunched: false, halfWidth: TRAIL_HALF_WIDTH, speed: 0, steer: 0,
      crashReason: null,
    });
  }

  function update(dt, input) {
    if (p.state === 'crashed') return;
    p.runTime += dt;
    p.stumbleAge += dt;
    p.softHitCooldown = Math.max(0, p.softHitCooldown - dt);

    p.speed = currentSpeed(p.runTime, p.stumbleAge, p.dragFactor);
    p.dragFactor = 1; // re-applied each tick by mud/water zones
    p.s += p.speed * dt;

    // steering
    p.steer = clamp(input.getSteer(), -1, 1);
    const authority = p.state === 'airborne' ? 0.4 : 1;
    p.l += p.steer * lateralSpeed(p.speed) * authority * dt;
    p.l = clamp(p.l, -p.halfWidth, p.halfWidth);

    // grinding the trail edge stumbles after 0.4 s (spec §4.2)
    const grinding = Math.abs(p.l) > p.halfWidth - 0.1 && Math.sign(p.steer) === Math.sign(p.l) && p.steer !== 0;
    p.edgeGrind = grinding && p.state === 'running' ? p.edgeGrind + dt : 0;
    if (p.edgeGrind > 0.4) { p.edgeGrind = 0; stumble('edge'); }

    if (p.state === 'running') {
      if (input.consumeJump()) jump(1);
    } else if (p.state === 'airborne') {
      p.vy -= GRAVITY * dt;
      p.footY += p.vy * dt;
      p.airTime += dt;

      if (!p.spinning && input.consumeTrick()) {
        p.spinning = true;
        p.spinAngle = 0;
        events.onSpinStart?.();
      }
      if (p.spinning) p.spinAngle += (TAU / SPIN_TIME) * dt;

      if (p.footY <= 0 && p.vy < 0) land(input);
    }
  }

  function jump(mult) {
    p.state = 'airborne';
    p.vy = JUMP_VELOCITY * mult;
    p.footY = Math.max(p.footY, 0.01);
    p.airTime = 0;
    p.rampLaunched = mult > 1.05;
    events.onJump?.(mult);
  }

  function land(input) {
    // landing mid-rotation = crash (spec §4.5)
    if (p.spinning) {
      const off = Math.abs(((p.spinAngle % TAU) + TAU) % TAU);
      const nearUpright = off < SPIN_LANDING_TOLERANCE || off > TAU - SPIN_LANDING_TOLERANCE;
      const spins = Math.round(p.spinAngle / TAU);
      if (!nearUpright) { crash('botched landing'); return; }
      if (spins > 0) events.onSpins?.(spins);
      p.spinning = false; p.spinAngle = 0;
    }
    p.state = 'running';
    p.footY = 0; p.vy = 0;
    events.onLand?.(p.airTime, p.rampLaunched);
    p.airTime = 0; p.rampLaunched = false;
    // buffered jump fires immediately (spec §4.3)
    if (input.consumeJump()) jump(1);
  }

  function stumble(source) {
    if (p.state === 'crashed') return;
    // a second soft hit while stumbling escalates (spec §4.4)
    if (p.stumbleAge < STUMBLE_DURATION && source !== 'edge') { crash('stumble pile-up'); return; }
    if (p.softHitCooldown > 0) return;
    p.stumbleAge = 0;
    p.softHitCooldown = 0.25;
    events.onStumble?.(source);
  }

  function crash(reason) {
    if (p.state === 'crashed') return;
    p.state = 'crashed';
    p.crashReason = reason;
    events.onCrash?.(reason);
  }

  return {
    p, update, reset, stumble, crash,
    rampLaunch(mult = RAMP_JUMP_MULT, viaJump = true) {
      jump(viaJump ? mult : RAMP_AUTO_MULT);
    },
    applyDrag(f) { p.dragFactor = Math.min(p.dragFactor, f); },
    setHalfWidth(w) { p.halfWidth = w; p.l = clamp(p.l, -w, w); },
    isStumbling: () => p.stumbleAge < STUMBLE_DURATION,
  };
}
