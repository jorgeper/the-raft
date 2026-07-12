// Data-driven spawn tables (spec §6.3). Pure data + pure functions — unit-tested.
import { clamp, lerp } from '../utils/math.js';

// { type, weight, minDistance, maxPerChunk?, forcedJump? }
export const SPAWN_TABLE = [
  // phase 1 — trailhead
  { type: 'rootSnarl', weight: 3, minDistance: 0 },
  { type: 'smallRock', weight: 3, minDistance: 0 },
  { type: 'boulder', weight: 2, minDistance: 40 },
  { type: 'mudPuddle', weight: 2, minDistance: 30 },
  { type: 'fallenBranch', weight: 2, minDistance: 60 },
  // phase 2 — deep forest
  { type: 'sheep', weight: 3, minDistance: 150 },
  { type: 'cow', weight: 2, minDistance: 200 },
  { type: 'hiker', weight: 2.5, minDistance: 170 },
  { type: 'dogLeash', weight: 1.6, minDistance: 220 },
  { type: 'log', weight: 2.5, minDistance: 180 },
  { type: 'stream', weight: 1.2, minDistance: 250, maxPerChunk: 1, forcedJump: true },
  // phase 3 — steep section
  { type: 'fallingTree', weight: 2, minDistance: 400 },
  { type: 'biker', weight: 2, minDistance: 430 },
  { type: 'rockslide', weight: 1.6, minDistance: 450, maxPerChunk: 1 },
  { type: 'deer', weight: 1.5, minDistance: 480 },
  { type: 'picnic', weight: 1.2, minDistance: 420 },
  { type: 'narrows', weight: 0.8, minDistance: 500, maxPerChunk: 1 },
  { type: 'logRamp', weight: 2, minDistance: 400 },
  // phase 4 — golden chaos
  { type: 'rollingLog', weight: 1.5, minDistance: 700, maxPerChunk: 1, forcedJump: true },
  { type: 'beeSwarm', weight: 1.5, minDistance: 720 },
  { type: 'ranger', weight: 1.2, minDistance: 750, maxPerChunk: 1 },
  { type: 'slalom', weight: 1, minDistance: 780, maxPerChunk: 1 },
  { type: 'chickens', weight: 1.5, minDistance: 700 },
  { type: 'waterfall', weight: 0.8, minDistance: 760, maxPerChunk: 1 },
];

// Average meters between obstacles: ~25 m at the trailhead down to ~7 m in
// the chaos phase (spec §6.3). Density capped past 900 m.
export function spawnSpacing(s) {
  return lerp(25, 7, clamp(s / 900, 0, 1));
}

// Past 900 m: paired spawns drawn from a combo table (spec §6.3).
export const COMBO_TABLE = [
  ['dogLeash', 'boulder'],
  ['biker', 'rockslide'],
  ['sheep', 'log'],
  ['cow', 'rootSnarl'],
  ['chickens', 'smallRock'],
  ['fallingTree', 'mudPuddle'],
];
export const COMBO_CHANCE = 0.35;
export const COMBO_START = 900;

export function eligibleTypes(s, chunkCounts = {}) {
  return SPAWN_TABLE.filter(
    (e) => s >= e.minDistance && (!e.maxPerChunk || (chunkCounts[e.type] || 0) < e.maxPerChunk)
  );
}

export function pickWeighted(entries, roll) {
  const total = entries.reduce((a, e) => a + e.weight, 0);
  let x = roll * total;
  for (const e of entries) {
    x -= e.weight;
    if (x <= 0) return e;
  }
  return entries[entries.length - 1];
}
