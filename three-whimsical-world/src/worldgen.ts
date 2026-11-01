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
  /** How many meadow groves there are (0..2). */
  groves: number;
  /** Density of large trees, broadleaf and spruce (0..2). */
  bigTrees: number;
  /** Density of young/small trees and spruce saplings (0..2). */
  smallTrees: number;
  /** Density of bushes and shrubs (0..3). */
  bushes: number;
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
  bigTrees: 1,
  smallTrees: 1,
  bushes: 1,
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
  /** Signed distance (m) from the river's water edge: negative in the channel, growing up the bank. */
  riverEdge: FieldFn;
  /** Each river's centerline z and half-width at a given x (rivers run toward the sea, +x). */
  riverCenters: (x: number) => { z: number; width: number }[];
  /** Small ponds in the meadows and forest edges, each with its own water level. */
  ponds: Pond[];
  /** Signed distance (m) from the nearest pond's waterline: negative in the water (large far from any pond). */
  pondEdge: FieldFn;
  /** Stone circles, rune stones and burial mounds (mounds are part of `height`). */
  landmarks: Landmark[];
  /** 1 where a landmark keeps the ground clear of trees and boulders, 0 elsewhere. */
  clearing: FieldFn;
  /** 0..1 heath: drifts of heather on open, higher ground, where the grass grows thin and short. */
  heath: FieldFn;
  /** Waterfalls spilling off gorge rims into the rivers below. */
  waterfalls: Waterfall[];
}

export interface Waterfall {
  /** The lip, on the rim. */
  x: number;
  z: number;
  /** Ground height at the lip. */
  top: number;
  /** Horizontal unit direction the water leaves in (toward the river). */
  dirX: number;
  dirZ: number;
}

export interface Landmark {
  kind: 'circle' | 'mound' | 'runestone' | 'oak';
  x: number;
  z: number;
  /** Ring radius of a circle, footprint radius of a mound, ~1.5 m around a rune stone, an oak's crown. */
  radius: number;
  /** A mound's height above the land; unused otherwise. */
  height: number;
  /** Which way it faces (a rune stone's carved face, a circle's gap). */
  yaw: number;
}

export interface Pond {
  x: number;
  z: number;
  /** Nominal radius of the water (the shore wobbles around it). */
  radius: number;
  /** Height of the water surface. */
  level: number;
  /** Deepest point below the surface. */
  depth: number;
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
  // Signed distance from the nearest river's water edge (negative in the channel). The edge wanders in and out
  // at two scales, so the banks are bays and points instead of a ruled line.
  const riverCenter = (rv: (typeof rivers)[number], x: number) =>
    rv.z0 + 170 * fbm(x * 0.0016 + rv.phase, rv.phase, 3) + 30 * noise(x * 0.008, rv.phase);
  const riverCenters = (x: number) => rivers.map((rv) => ({ z: riverCenter(rv, x), width: rv.width }));
  const riverEdge = (x: number, z: number) => {
    let d = Infinity;
    for (const rv of rivers) d = Math.min(d, Math.abs(z - riverCenter(rv, x)) - rv.width);
    return d + 4 * noise(x * 0.03 + 11, z * 0.03) + 1.5 * noise(x * 0.11, z * 0.11 - 5);
  };
  const riverField = (x: number, z: number) => 1 - smoothstep(0, 45, riverEdge(x, z));

  const coastline = (z: number) => 220 + 110 * fbm(z * 0.0018, 4.2, 4);

  const baseHeight: HeightFn = (x, z) => {
    // Domain warp keeps hills from looking like uniform noise blobs.
    const wx = x + 60 * noise(x * 0.0015, z * 0.0015);
    const wz = z + 60 * noise(x * 0.0015 + 31.7, z * 0.0015 - 17.3);

    const hills = fbm(wx * 0.0028, wz * 0.0028, 6);
    let land = 9 + params.hills * (hills * 11 + 1.2 * fbm(x * 0.03, z * 0.03, 3));

    // Mountain ridges far inland, plus occasional peaks rising out of the meadows.
    const backdrop = smoothstep(-250, -800, x);
    const peaks = smoothstep(0.45, 0.85, noise(x * 0.0011 + 7, z * 0.0011 - 3)) * smoothstep(80, -150, x);
    land += params.mountains * (backdrop * 70 + peaks * 90) * ridged(wx * 0.002, wz * 0.002, 5);

    // Rivers: a channel just below sea level, a low gravel shelf along the water, then the bank climbing back
    // to the land in rock ledges (a single smooth ramp read as a fake, sculpted wall), with lumpy outcrops.
    const edge = riverEdge(x, z);
    if (edge < 70) {
      const n1 = noise(x * 0.02 + 5, z * 0.02 - 9), n2 = noise(x * 0.013 - 21, z * 0.013 + 4);
      const shelfW = 3 + 3 * (0.5 + 0.5 * n1);
      const shelf = 0.35 + 0.35 * noise(x * 0.06, z * 0.06 + 3);
      const bankW = 26 + 14 * (0.5 + 0.5 * n2);
      // (Fading the shelf's floor out by 60 m keeps low land near the coast continuous where the carving ends.)
      const top = Math.max(land, shelf * (1 - smoothstep(30, 60, edge)));
      // Ledges: each step a flat tread and a steep riser, at least ~8 m wide so the 2.5 m mesh can hold them.
      const steps = Math.max(1, Math.min((top - shelf) / 3.2, bankW / 8));
      let t = smoothstep(shelfW, shelfW + bankW, edge);
      const terraced = (Math.floor(t * steps) + smoothstep(0.45, 1, (t * steps) % 1)) / steps;
      t = lerp(t, terraced, 0.75 * smoothstep(4, 10, top - shelf));
      let bank = lerp(shelf, top, t);
      // Outcrops and slumps on the bank face, none on the shelf or the land above.
      const face = smoothstep(shelfW, shelfW + 5, edge) * (1 - smoothstep(shelfW + bankW, shelfW + bankW + 12, edge));
      bank += face * (2.2 * ridged(x * 0.035, z * 0.035, 3) - 1.2 + 0.8 * noise(x * 0.09, z * 0.09));
      // Into the channel: from the shelf down to the riverbed.
      land = lerp(-1.4, bank, smoothstep(-3, 0.5, edge));
    }

    // Wavy coastline running roughly north-south.
    const inland = coastline(z) - x;
    const seabed = -22 + 5 * fbm(x * 0.004, z * 0.004, 3);
    let h = lerp(seabed, land, smoothstep(-70, 150, inland));

    // Flatten a gentle beach shelf right at the shoreline.
    const beach = smoothstep(-35, 0, inland) * (1 - smoothstep(10, 55, inland));
    h = lerp(h, 0.8 + 0.6 * (inland / 50), beach * 0.75);
    return h;
  };

  // Ponds: small basins on flat ground in the meadows and along forest edges, away from rivers and the coast, one
  // of them in view of the start. The water level sits below the lowest ground around the rim, so it can't spill.
  const pondRand = mulberry32(params.seed * 31 + 977);
  const ponds: Pond[] = [];
  const trySite = (x: number, z: number, radius: number) => {
    const h0 = baseHeight(x, z);
    if (h0 < 4.5 || h0 > 40 || riverEdge(x, z) < 35 + radius || coastline(z) - x < 120) return false;
    if (ponds.some((p) => Math.hypot(p.x - x, p.z - z) < 140)) return false;
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      for (const f of [0.6, 1.1, 1.6]) {
        const hh = baseHeight(x + Math.cos(a) * radius * f, z + Math.sin(a) * radius * f);
        lo = Math.min(lo, hh);
        hi = Math.max(hi, hh);
      }
    }
    // Flat enough that the basin reads as a pond, not a notch cut in a slope.
    if (hi - lo > 2.2) return false;
    ponds.push({ x, z, radius, level: lo - 0.35, depth: 0.9 + pondRand() * 0.8 });
    return true;
  };
  for (let i = 0; i < 400 && !ponds.length; i++) {
    const a = pondRand() * Math.PI * 2, d = 45 + pondRand() * 70;
    trySite(-30 + Math.cos(a) * d, Math.sin(a) * d, 7 + pondRand() * 4);
  }
  for (let i = 0; i < 4000 && ponds.length < 14; i++) {
    trySite(-750 + pondRand() * 850, -900 + pondRand() * 1800, 6 + pondRand() * 9);
  }

  /** Signed distance from a pond's waterline, and that pond (the shore wobbles in coves and points). */
  const pondAt = (x: number, z: number): [number, Pond | null] => {
    let best = Infinity, which: Pond | null = null;
    for (const p of ponds) {
      const dx = x - p.x, dz = z - p.z;
      if (Math.abs(dx) > p.radius * 2.5 || Math.abs(dz) > p.radius * 2.5) continue;
      const rr = p.radius * (1 + 0.2 * noise(x * 0.12 + p.x, z * 0.12) + 0.08 * noise(x * 0.4, z * 0.4 - p.z));
      const e = Math.hypot(dx, dz) - rr;
      if (e < best) (best = e), (which = p);
    }
    return [best, which];
  };
  const pondEdge: FieldFn = (x, z) => pondAt(x, z)[0];

  // Burial mounds raise the land (filled in below, once the forest field exists to choose their sites).
  const mounds: Landmark[] = [];
  const moundHeight = (x: number, z: number) => {
    let add = 0;
    for (const m of mounds) {
      const dx = x - m.x, dz = z - m.z;
      if (Math.abs(dx) > m.radius || Math.abs(dz) > m.radius) continue;
      const t = (dx * dx + dz * dz) / (m.radius * m.radius);
      // A full dome with a soft foot, a little lumpy.
      if (t < 1) add = Math.max(add, m.height * Math.pow(1 - t, 1.6) * (1 + 0.06 * noise(x * 0.3 + m.x, z * 0.3)));
    }
    return add;
  };

  const height: HeightFn = (x, z) => {
    const h = baseHeight(x, z) + moundHeight(x, z);
    const [e, p] = pondAt(x, z);
    if (!p) return h;
    // A bowl under the water, then a low shore rising back to the land over a few meters.
    const inside = Math.max(-e / p.radius, 0);
    const bed = p.level - 0.12 - p.depth * Math.pow(Math.min(inside * 1.6, 1), 0.8) + 0.15 * noise(x * 0.5, z * 0.5);
    const shore = smoothstep(0, p.radius * 0.6 + 2.5, e);
    return e < 0 ? Math.min(h, bed) : Math.min(h, lerp(p.level - 0.12, h, shore) + 0.12 * shore * noise(x * 0.3, z * 0.3));
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

  // Landmarks: stone circles on open meadow (one in reach of the start), barrow clusters with a rune stone beside
  // them, and lone rune stones. Their own random stream, so nothing else moves.
  const siteRand = mulberry32(params.seed * 53 + 1301);
  const landmarks: Landmark[] = [];
  const site = (x: number, z: number, r: number, maxForest: number, tolerance: number) => {
    const h0 = baseHeight(x, z);
    if (h0 < 4 || h0 > 60 || riverEdge(x, z) < r + 18 || coastline(z) - x < 90) return false;
    if (forest(x, z) > maxForest || pondEdge(x, z) < r + 12) return false;
    if (landmarks.some((l) => Math.hypot(l.x - x, l.z - z) < l.radius + r + 25)) return false;
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const hh = baseHeight(x + Math.cos(a) * r, z + Math.sin(a) * r);
      lo = Math.min(lo, hh);
      hi = Math.max(hi, hh);
    }
    return hi - lo < tolerance;
  };
  const add = (kind: Landmark['kind'], x: number, z: number, radius: number, h = 0) =>
    landmarks.push({ kind, x, z, radius, height: h, yaw: siteRand() * Math.PI * 2 });
  // The ring on the bluff above the beach (rocks.ts raises it), with a rune stone on the way up from the start.
  landmarks.push({ kind: 'circle', x: 30, z: -40, radius: 7, height: 0, yaw: 0 });
  landmarks.push({ kind: 'runestone', x: 15, z: -43, radius: 1.5, height: 0, yaw: Math.atan2(-30 - 15, 0 + 43) });
  for (let i = 0, n = 0; i < 4000 && n < 2; i++) {
    const x = -750 + siteRand() * 850, z = -900 + siteRand() * 1800, r = 7 + siteRand() * 3;
    if (site(x, z, r + 3, 0.12, 2)) (add('circle', x, z, r), n++);
  }
  for (let i = 0, n = 0; i < 4000 && n < 3; i++) {
    const x = -750 + siteRand() * 850, z = -900 + siteRand() * 1800;
    if (!site(x, z, 40, 0.25, 6)) continue;
    // A barrow cemetery: two to four mounds side by side, and a rune stone at its edge.
    const count = 2 + Math.floor(siteRand() * 3), dir = siteRand() * Math.PI * 2;
    let cx = x, cz = z, prev = 0;
    for (let k = 0; k < count; k++) {
      const r = 7 + siteRand() * 4, h = 1.8 + siteRand() * 1.4;
      if (k > 0) {
        const a = dir + (siteRand() - 0.5) * 1.2;
        cx += Math.cos(a) * (prev + r + 2);
        cz += Math.sin(a) * (prev + r + 2);
      }
      const m: Landmark = { kind: 'mound', x: cx, z: cz, radius: r, height: h, yaw: 0 };
      landmarks.push(m);
      mounds.push(m);
      prev = r;
    }
    // The carved face looks out, away from the barrows.
    landmarks.push({ kind: 'runestone', x: x - Math.cos(dir) * 13, z: z - Math.sin(dir) * 13, radius: 1.5, height: 0, yaw: Math.atan2(-Math.cos(dir), -Math.sin(dir)) });
    n++;
  }
  for (let i = 0, n = 0; i < 4000 && n < 6; i++) {
    const x = -750 + siteRand() * 850, z = -900 + siteRand() * 1800;
    if (site(x, z, 3, 0.5, 1.5)) (add('runestone', x, z, 1.5), n++);
  }
  // Lone giant oaks on hilltops: the most prominent open, flattish crests (one within sight of the start). Scored
  // by how far the crest stands above the land 60 m around it.
  const oakSite = (x: number, z: number) => {
    if (!site(x, z, 12, 0.08, 3.5)) return -Infinity;
    const h0 = baseHeight(x, z);
    let ring = 0;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      ring += baseHeight(x + Math.cos(a) * 60, z + Math.sin(a) * 60) / 8;
    }
    return h0 - ring;
  };
  for (const [near, far] of [[110, 320], [200, 900]]) {
    let best = { x: 0, z: 0, score: 2.5 };
    for (let i = 0; i < 2500; i++) {
      const a = siteRand() * Math.PI * 2, d = near + siteRand() * (far - near);
      const x = -30 + Math.cos(a) * d, z = Math.sin(a) * d;
      const score = oakSite(x, z);
      if (score > best.score) best = { x, z, score };
    }
    if (best.score > 2.5) add('oak', best.x, best.z, 14);
  }
  // Waterfalls: where a gorge wall drops a long way into a river, a spring spills over the rim. The steepest drops,
  // kept well apart. (A coarse scan: the gorges are in the mountains, far inland.)
  const waterfalls: Waterfall[] = [];
  {
    const cands: { x: number; z: number; top: number; a: number; drop: number }[] = [];
    for (let x = -860; x < 100; x += 8) {
      for (let z = -960; z < 960; z += 8) {
        if (riverEdge(x, z) < 1.5) continue;
        const top = height(x, z);
        if (top < 10) continue;
        let drop = 0, dir = 0;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          const bx = x + Math.cos(a) * 12, bz = z + Math.sin(a) * 12;
          if (riverEdge(bx, bz) > -0.5) continue;
          const d = top - Math.max(height(bx, bz), 0);
          if (d > drop) (drop = d), (dir = a);
        }
        if (drop > 11) cands.push({ x, z, top, a: dir, drop });
      }
    }
    cands.sort((p, q) => q.drop - p.drop);
    for (const c of cands) {
      if (waterfalls.length >= 5) break;
      if (waterfalls.some((w) => Math.hypot(w.x - c.x, w.z - c.z) < 160)) continue;
      waterfalls.push({ x: c.x, z: c.z, top: c.top, dirX: Math.cos(c.a), dirZ: Math.sin(c.a) });
    }
  }

  const clearing: FieldFn = (x, z) => {
    for (const w of waterfalls) if (Math.abs(x - w.x) < 6 && Math.abs(z - w.z) < 6) return 1;
    for (const l of landmarks) {
      const reach = l.kind === 'circle' ? l.radius + 4 : l.kind === 'mound' ? l.radius * 0.9 : l.kind === 'oak' ? l.radius : 2.5;
      if (Math.abs(x - l.x) < reach && Math.abs(z - l.z) < reach && Math.hypot(x - l.x, z - l.z) < reach) return 1;
    }
    return 0;
  };

  // Heath drifts, on their own noise so nothing else moves.
  const heathNoise = createNoise2D(mulberry32(params.seed * 71 + 5));
  const heath: FieldFn = (x, z) => {
    const drift = smoothstep(0.2, 0.55, heathNoise(x * 0.008, z * 0.008) + 0.2 * heathNoise(x * 0.04, z * 0.04));
    if (drift <= 0) return 0;
    const h = baseHeight(x, z);
    return drift * smoothstep(4, 7, h) * (0.2 + 0.8 * smoothstep(8, 22, h)) * (1 - smoothstep(0.12, 0.35, forest(x, z)));
  };

  return { params, height, forest, dirt, river: riverField, riverEdge, riverCenters, ponds, pondEdge, landmarks, clearing, heath, waterfalls };
}
