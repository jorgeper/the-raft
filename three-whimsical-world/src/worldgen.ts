import { createNoise2D } from 'simplex-noise';

/** User-facing knobs for generating a world. */
export interface WorldParams {
  seed: number;
  /** Rolling-hill amplitude on the meadows (0 = flat, 1 = default, 2 = very hilly). */
  hills: number;
  /** Height of mountain ridges inland and scattered peaks (0 = none). */
  mountains: number;
  /** Number of rivers running from the hills to the sea. */
  rivers: number;
  /** Boulder and pebble density (0 = none, 1 = default). */
  rocks: number;
  /** Fraction of land covered by dense forest (0..1). */
  forest: number;
  /** Tree density in meadow groves (0..2). */
  groves: number;
  /** Flower density in the meadows (0..2). */
  flowers: number;
}

export const DEFAULT_PARAMS: WorldParams = {
  seed: 1337,
  hills: 1,
  mountains: 1,
  rivers: 2,
  rocks: 1,
  forest: 0.35,
  groves: 1,
  flowers: 1,
};

/** Returns terrain height in meters at world (x, z). Sea level is y = 0. */
export type HeightFn = (x: number, z: number) => number;
export type FieldFn = (x: number, z: number) => number;

export interface WorldFns {
  params: WorldParams;
  height: HeightFn;
  /** 0 on open meadow, 1 deep in a forest. */
  forest: FieldFn;
  /** 0..1 patches of bare earth showing through the meadow grass. */
  dirt: FieldFn;
  /** 0..1 how close to a river channel (1 = in the water). */
  river: FieldFn;
}

export function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Builds the world's fields from params: meadows rolling inland (-x), a beach, open sea toward +x,
 * mountains, rivers carved down to below sea level (so the global water plane fills them), and
 * forest/meadow and bare-earth masks. Same seed + params = same world.
 */
export function createWorld(params: WorldParams): WorldFns {
  const rand = mulberry32(params.seed);
  const noise = createNoise2D(rand);
  const forestNoise = createNoise2D(rand);
  const dirtNoise = createNoise2D(rand);

  const fbm = (x: number, z: number, octaves: number, n = noise) => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * n(x * freq, z * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  };
  const ridged = (x: number, z: number, octaves: number) => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * (1 - Math.abs(noise(x * freq + 91, z * freq - 37)));
      norm += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum / norm;
  };

  // Each river follows a meandering line from far inland toward the sea, spread across the coast.
  const riverCount = Math.round(params.rivers);
  const rivers = Array.from({ length: riverCount }, (_, i) => ({
    z0: (riverCount === 1 ? 0 : -650 + (1300 * i) / Math.max(riverCount - 1, 1)) + (rand() - 0.5) * 200,
    phase: rand() * 100,
    width: 7 + rand() * 6,
  }));
  const riverField = (x: number, z: number) => {
    let r = 0;
    for (const rv of rivers) {
      const center = rv.z0 + 170 * fbm(x * 0.0016 + rv.phase, rv.phase, 3) + 30 * noise(x * 0.008, rv.phase);
      const d = Math.abs(z - center);
      r = Math.max(r, 1 - smoothstep(rv.width, rv.width + 45, d));
    }
    return r;
  };

  const coastline = (z: number) => 220 + 110 * fbm(z * 0.0018, 4.2, 4);

  const height: HeightFn = (x, z) => {
    // Domain warp keeps hills from looking like uniform noise blobs.
    const wx = x + 60 * noise(x * 0.0015, z * 0.0015);
    const wz = z + 60 * noise(x * 0.0015 + 31.7, z * 0.0015 - 17.3);

    const hills = fbm(wx * 0.0028, wz * 0.0028, 6);
    let land = 9 + params.hills * (hills * 11 + 1.2 * fbm(x * 0.03, z * 0.03, 3));

    // Mountain ridges far inland, plus occasional peaks rising out of the meadows.
    const backdrop = smoothstep(-250, -800, x);
    const peaks = smoothstep(0.45, 0.85, noise(x * 0.0011 + 7, z * 0.0011 - 3)) * smoothstep(80, -150, x);
    land += params.mountains * (backdrop * 70 + peaks * 90) * ridged(wx * 0.002, wz * 0.002, 5);

    // Rivers: carve a channel just below sea level, with sloped banks.
    const r = riverField(x, z);
    if (r > 0) land = lerp(land, Math.min(land, -1.4), r * r * (3 - 2 * r));

    // Wavy coastline running roughly north-south.
    const inland = coastline(z) - x;
    const seabed = -22 + 5 * fbm(x * 0.004, z * 0.004, 3);
    let h = lerp(seabed, land, smoothstep(-70, 150, inland));

    // Flatten a gentle beach shelf right at the shoreline.
    const beach = smoothstep(-35, 0, inland) * (1 - smoothstep(10, 55, inland));
    h = lerp(h, 0.8 + 0.6 * (inland / 50), beach * 0.75);
    return h;
  };

  // forest = 0 → threshold above any noise value (no forest); forest = 1 → below all (all forest).
  const threshold = lerp(0.85, -0.85, params.forest);
  const forest: FieldFn = (x, z) => {
    const n = fbm(x * 0.0022, z * 0.0022, 4, forestNoise);
    // Forests favour the hills inland and thin out toward the beach.
    const inlandBias = 0.25 * smoothstep(150, -300, x) - 0.35 * smoothstep(0, 180, x);
    return smoothstep(threshold - 0.06, threshold + 0.06, n + inlandBias);
  };

  const dirt: FieldFn = (x, z) => {
    const n = fbm(x * 0.018, z * 0.018, 3, dirtNoise) + 0.35 * dirtNoise(x * 0.004, z * 0.004);
    return smoothstep(0.42, 0.62, n);
  };

  return { params, height, forest, dirt, river: riverField };
}
