// The "can't stop" rule (spec §4.1). Pure, unit-tested.
export const START_SPEED = 7;
export const RAMP_RATE = 0.28;
export const MAX_SPEED = 30;
export const MIN_SPEED = 6;

export function speedAt(t) {
  return Math.min(MAX_SPEED, START_SPEED + RAMP_RATE * t);
}

// Stumble: -30% forward speed recovering over 0.8 s (spec §4.4).
export const STUMBLE_PENALTY = 0.3;
export const STUMBLE_DURATION = 0.8;

export function stumbleFactor(timeSinceStumble) {
  if (timeSinceStumble < 0 || timeSinceStumble >= STUMBLE_DURATION) return 1;
  return 1 - STUMBLE_PENALTY * (1 - timeSinceStumble / STUMBLE_DURATION);
}

export function currentSpeed(runTime, timeSinceStumble, dragFactor = 1) {
  return Math.max(MIN_SPEED, speedAt(runTime) * stumbleFactor(timeSinceStumble) * dragFactor);
}

// Lateral speed scales with forward speed (spec §4.2).
export function lateralSpeed(forwardSpeed) {
  return Math.min(11, Math.max(4, 0.45 * forwardSpeed));
}

export const JUMP_VELOCITY = 8.5;
export const GRAVITY = 25;
export const RAMP_JUMP_MULT = 1.6;
export const RAMP_AUTO_MULT = 1.3;
