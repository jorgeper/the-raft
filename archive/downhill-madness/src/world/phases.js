import { clamp, smoothstep, lerp } from '../utils/math.js';

// Biome phases (spec §5.1). Sky stays blue, mood stays cozy in all of them.
export const PHASES = [
  { name: 'trailhead', start: 0 },
  { name: 'forest', start: 150 },
  { name: 'steep', start: 400 },
  { name: 'golden', start: 700 },
];

export function phaseIndexAt(s) {
  for (let i = PHASES.length - 1; i >= 0; i--) if (s >= PHASES[i].start) return i;
  return 0;
}

// Continuous phase value: 0..3 with 30 m blends at boundaries (spec §5.1).
export function phaseMixAt(s) {
  let m = 0;
  for (let i = 1; i < PHASES.length; i++) m += smoothstep(PHASES[i].start - 15, PHASES[i].start + 15, s);
  return m;
}

// Visual parameters keyed by integer phase; renderer lerps between rows.
const P = [
  // trailhead: sunny meadow-edge morning
  { sun: [1.0, 0.96, 0.86], sunIntensity: 2.6, sunAlt: 0.85, hemiSky: [0.62, 0.8, 0.98], hemiGround: [0.45, 0.62, 0.34], hemiIntensity: 0.9, fog: [0.78, 0.88, 0.97], fogDensity: 0.0038, skyTop: [0.36, 0.66, 0.93], skyBottom: [0.82, 0.92, 0.99], treeDensity: 0.55, fernDensity: 0.8, flowerDensity: 1.0 },
  // deep forest: lush canopy, dappled light
  { sun: [1.0, 0.94, 0.78], sunIntensity: 2.4, sunAlt: 0.75, hemiSky: [0.55, 0.75, 0.9], hemiGround: [0.35, 0.55, 0.3], hemiIntensity: 0.75, fog: [0.72, 0.85, 0.9], fogDensity: 0.0055, skyTop: [0.32, 0.6, 0.9], skyBottom: [0.78, 0.9, 0.96], treeDensity: 1.0, fernDensity: 1.0, flowerDensity: 0.35 },
  // steep: open rocky slopes bursting with wildflowers
  { sun: [1.0, 0.95, 0.8], sunIntensity: 2.7, sunAlt: 0.65, hemiSky: [0.6, 0.78, 0.95], hemiGround: [0.5, 0.6, 0.35], hemiIntensity: 0.85, fog: [0.8, 0.88, 0.95], fogDensity: 0.0035, skyTop: [0.34, 0.63, 0.92], skyBottom: [0.85, 0.92, 0.97], treeDensity: 0.45, fernDensity: 0.45, flowerDensity: 1.4 },
  // golden chaos: warm golden-hour, long shadows, still cozy
  { sun: [1.0, 0.78, 0.5], sunIntensity: 2.9, sunAlt: 0.38, hemiSky: [0.65, 0.7, 0.85], hemiGround: [0.55, 0.5, 0.3], hemiIntensity: 0.8, fog: [0.95, 0.85, 0.72], fogDensity: 0.005, skyTop: [0.4, 0.58, 0.85], skyBottom: [0.99, 0.85, 0.62], treeDensity: 0.8, fernDensity: 0.6, flowerDensity: 0.8 },
];

const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

export function phaseParamsAt(s) {
  const m = clamp(phaseMixAt(s), 0, P.length - 1);
  const i = Math.min(Math.floor(m), P.length - 2);
  const t = m - i;
  const a = P[i], b = P[i + 1];
  const out = {};
  for (const k of Object.keys(a)) {
    out[k] = Array.isArray(a[k]) ? lerp3(a[k], b[k], t) : lerp(a[k], b[k], t);
  }
  out.mix = m;
  return out;
}
