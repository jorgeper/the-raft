/**
 * Builds the cliff shell for one tile of terrain (see `src/cliffs.ts`): each steep cell of the heightfield is
 * re-tessellated at about half a meter and pushed out from the face into rock. The terrain's own triangles stay
 * underneath; the shell starts exactly on them (the same two triangles per cell) and only ever stands proud of them,
 * so where it thins to nothing at the foot and crest of a cliff it meets the ground without a seam.
 *
 * The rock: tall buttresses and fluted columns, beds of stone that step out as ledges with seams between (the same
 * beds the shader colors, `src/strata.ts`), vertical joints cut back into the face, and a fine roughness.
 */
import { createNoise3D } from 'simplex-noise';
import { mulberry32, smoothstep } from './worldgen';
import { bedCoord, bedHash } from './strata';

export interface CliffInit {
  type: 'init';
  size: number;
  segments: number;
  heights: Float32Array;
  colors: Float32Array;
  grass: Float32Array;
  splat: Float32Array;
  waterfalls: { x: number; z: number; dirX: number; dirZ: number }[];
  seed: number;
}
export interface CliffRequest {
  type: 'tile';
  key: string;
  ti: number;
  tj: number;
  tile: number;
}
export interface CliffTile {
  key: string;
  position?: Float32Array;
  normal?: Float32Array;
  color?: Float32Array;
  grass?: Float32Array;
  splat?: Float32Array;
  disp?: Float32Array;
  index?: Uint32Array;
}

/** Target edge length of the shell's triangles (m). */
const RES = 0.5;

let W: CliffInit;
let N1 = 0;
let cell = 0;
let half = 0;
/** Per grid corner: the slope's gradient, and how much rock the shell raises there (0 = none). */
let gx: Float32Array, gz: Float32Array, amp: Float32Array;
let noise: (x: number, y: number, z: number) => number;

function init(msg: CliffInit) {
  W = msg;
  N1 = msg.segments + 1;
  cell = msg.size / msg.segments;
  half = msg.size / 2;
  noise = createNoise3D(mulberry32(msg.seed * 7 + 3));
  const h = msg.heights;
  gx = new Float32Array(N1 * N1);
  gz = new Float32Array(N1 * N1);
  amp = new Float32Array(N1 * N1);
  for (let j = 0; j < N1; j++) {
    for (let i = 0; i < N1; i++) {
      const k = j * N1 + i;
      const i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, N1 - 1), j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, N1 - 1);
      gx[k] = (h[j * N1 + i1] - h[j * N1 + i0]) / ((i1 - i0) * cell);
      gz[k] = (h[j1 * N1 + i] - h[j0 * N1 + i]) / ((j1 - j0) * cell);
      // Rock from about 40° (a rise of 0.85 per meter) to full at 58°; none deep under the sea.
      let a = smoothstep(0.85, 1.6, Math.hypot(gx[k], gz[k])) * smoothstep(-6, -2, h[k]);
      if (a > 0) {
        // Not where a waterfall pours over the face: its curtain hangs a few meters out from the rock.
        const x = -half + i * cell, z = -half + j * cell;
        for (const f of msg.waterfalls) {
          const dx = x - f.x, dz = z - f.z;
          const along = Math.min(Math.max(dx * f.dirX + dz * f.dirZ, 0), 8);
          const d = Math.hypot(dx - f.dirX * along, dz - f.dirZ * along);
          a *= smoothstep(5, 13, d);
        }
      }
      amp[k] = a;
    }
  }
}

/** A hash of two integers to [0, 1). */
function hash2(i: number, j: number, salt: number) {
  let x = (Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ salt) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const JOINT = 5.5;
const voronoi = { id: 0, edge: 0 };
/** Joints: the rock splits into vertical columns, Voronoi cells of the level plane (`id`, and `edge`: m to a joint). */
function columns(x: number, z: number) {
  const ci = Math.floor(x / JOINT), cj = Math.floor(z / JOINT);
  let d1 = 1e9, d2 = 1e9, id = 0;
  for (let j = cj - 1; j <= cj + 1; j++) {
    for (let i = ci - 1; i <= ci + 1; i++) {
      const px = (i + 0.15 + 0.7 * hash2(i, j, 11)) * JOINT, pz = (j + 0.15 + 0.7 * hash2(i, j, 12)) * JOINT;
      const d = Math.hypot(x - px, z - pz);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = i * 7919 + j;
      } else if (d < d2) d2 = d;
    }
  }
  voronoi.id = id;
  voronoi.edge = (d2 - d1) * 0.5;
  return voronoi;
}

/**
 * How far the rock stands out from the face at a point of the face (m, before the amplitude). The rock is jointed
 * into blocks: vertical joints split it into columns, the beds cut those into blocks, and each block stands out by
 * its own amount with a nearly flat face, its edges rounded off. Broad buttresses swell under them all.
 */
function relief(x: number, y: number, z: number) {
  const buttress = smoothstep(-0.35, 0.8, noise(x * 0.07, y * 0.02, z * 0.07)) * 0.9;
  const b = bedCoord(x, y, z), k = Math.floor(b), f = b - k;
  const c = columns(x, z);
  // Some rock is massive (smooth buttresses and beds), some breaks into blocks; it changes across the land.
  const blocky = smoothstep(-0.35, 0.45, noise(x * 0.012 + 40, y * 0.008, z * 0.012));
  // Each block's own offset: partly the column's (columns run through several beds), partly the block's.
  const block = (0.55 * hash2(c.id, 0, 21) + 0.75 * hash2(c.id, k, 22) * (0.4 + 0.6 * bedHash(k, 3))) * (0.2 + 0.8 * blocky);
  // Rounded edges: the block's face eases back into the joints and the bedding seams, over a meter or so (a
  // sharper step than the half-meter mesh can hold breaks up into sawtooth triangles).
  const jointRound = 1 - (0.25 + 0.75 * blocky) * (1 - smoothstep(0.0, 0.9, c.edge));
  // A bed swells slowly from its base to a lip near its top, then falls back into the seam under the next one.
  // In places the beds weld together and the seams fade.
  const seams = 0.3 + 0.7 * smoothstep(-0.4, 0.4, noise(x * 0.035, y * 0.02 + 50, z * 0.035));
  const bedRound = 1 - seams * (1 - smoothstep(0.0, 0.55, f) * (1 - smoothstep(0.8, 1.0, f)));
  // A face is never quite flat: a gentle warp. (Nothing finer than a couple of meters: the half-meter mesh would
  // sample it into moiré; the rock scan's normal map carries the grain.)
  const warp = 0.14 * noise(x * 0.3, y * 0.15, z * 0.3);
  return Math.max(0.25 + buttress + (0.25 + block) * jointRound * bedRound + warp, 0);
}

/** A point of the shell (`sx`, `sy`, `sz`) and how far it was pushed out (`dx`, `dz`), from `surface`. */
const S = { x: 0, y: 0, z: 0, dx: 0, dz: 0 };

/**
 * The shell at continuous grid coordinates (fi, fj): the terrain's own surface there (its two triangles per cell),
 * pushed out of the face by the rock's relief. One function for the whole world, so neighboring cells and tiles agree.
 */
function surface(fi: number, fj: number) {
  const i = Math.min(Math.max(Math.floor(fi), 0), N1 - 2), j = Math.min(Math.max(Math.floor(fj), 0), N1 - 2);
  const u = fi - i, v = fj - j;
  const h = W.heights;
  const ka = j * N1 + i, kb = ka + N1, kc = kb + 1, kd = ka + 1;
  const ha = h[ka], hb = h[kb], hc = h[kc], hd = h[kd];
  // Triangle a-b-d where u + v <= 1, b-c-d beyond (the terrain splits each cell along b-d).
  const y = u + v <= 1 ? ha + u * (hd - ha) + v * (hb - ha) : hc + (1 - u) * (hb - hc) + (1 - v) * (hd - hc);
  const x = -half + fi * cell, z = -half + fj * cell;
  const wa = (1 - u) * (1 - v), wb = (1 - u) * v, wc = u * v, wd = u * (1 - v);
  const A = wa * amp[ka] + wb * amp[kb] + wc * amp[kc] + wd * amp[kd];
  let d = 0, ox = 0, oz = 0;
  if (A > 0.001) {
    // Out of the face: downhill, level.
    const sx = wa * gx[ka] + wb * gx[kb] + wc * gx[kc] + wd * gx[kd];
    const sz = wa * gz[ka] + wb * gz[kb] + wc * gz[kc] + wd * gz[kd];
    const sl = Math.hypot(sx, sz) || 1;
    ox = -sx / sl;
    oz = -sz / sl;
    d = A * relief(x, y, z);
  }
  S.x = x + ox * d;
  S.y = y;
  S.z = z + oz * d;
  S.dx = ox * d;
  S.dz = oz * d;
  return S;
}

/** Vertical spacing of the shell's rows (m): every row is a level contour, so the beds' seams run along them. */
const LEVEL = 0.4;

type P3 = [number, number, number];

/** Where a level crosses an edge; ordered by height, so the two triangles sharing an edge get identical points. */
function edgePoint(a: P3, b: P3, level: number): P3 {
  const [lo, hi] = a[1] < b[1] || (a[1] === b[1] && (a[0] < b[0] || (a[0] === b[0] && a[2] < b[2]))) ? [a, b] : [b, a];
  const t = (level - lo[1]) / (hi[1] - lo[1]);
  return [lo[0] + (hi[0] - lo[0]) * t, level, lo[2] + (hi[2] - lo[2]) * t];
}

class TileBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  gr: number[] = [];
  sp: number[] = [];
  disp: number[] = [];
  idx: number[] = [];
  /** Base (undisplaced) positions, for orienting triangles. */
  private base: number[] = [];

  /** Adds a shell vertex over a point of the terrain; `up`: the terrain triangle's gradient, for the normal's steps. */
  vertex(p: P3, gxT: number, gzT: number) {
    const fi = (p[0] + half) / cell, fj = (p[2] + half) / cell;
    // The normal: central differences of the shell itself, a mesh step each way (along the level, and up the slope by
    // one row), so shading sees the surface the triangles draw and agrees across cells and tiles.
    const gl = Math.hypot(gxT, gzT) || 1;
    const cx = -gzT / gl, cz = gxT / gl;
    const h1 = (RES * 0.8) / cell;
    const h2 = LEVEL / (gl * gl) / cell;
    surface(fi + cx * h1, fj + cz * h1);
    const ax0 = S.x, ay0 = S.y, az0 = S.z;
    surface(fi - cx * h1, fj - cz * h1);
    const ax = ax0 - S.x, ay = ay0 - S.y, az = az0 - S.z;
    surface(fi + gxT * h2, fj + gzT * h2);
    const bx0 = S.x, by0 = S.y, bz0 = S.z;
    surface(fi - gxT * h2, fj - gzT * h2);
    const bx = bx0 - S.x, by = by0 - S.y, bz = bz0 - S.z;
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    // Facing out of the ground (against the uphill gradient, and up).
    if (nx * -gxT + ny + nz * -gzT < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const l = Math.hypot(nx, ny, nz) || 1;
    surface(fi, fj);
    const n = this.pos.length / 3;
    this.pos.push(S.x, S.y, S.z);
    this.disp.push(S.dx, 0, S.dz);
    this.nor.push(nx / l, ny / l, nz / l);
    this.base.push(p[0], p[1], p[2]);
    // The terrain's colors and layers, interpolated over the cell.
    const i = Math.min(Math.max(Math.floor(fi), 0), N1 - 2), j = Math.min(Math.max(Math.floor(fj), 0), N1 - 2);
    const u = fi - i, v = fj - j;
    const ka = j * N1 + i, kb = ka + N1, kc = kb + 1, kd = ka + 1;
    const wa = (1 - u) * (1 - v), wb = (1 - u) * v, wc = u * v, wd = u * (1 - v);
    for (let c = 0; c < 3; c++) this.col.push(wa * W.colors[ka * 3 + c] + wb * W.colors[kb * 3 + c] + wc * W.colors[kc * 3 + c] + wd * W.colors[kd * 3 + c]);
    this.gr.push(wa * W.grass[ka] + wb * W.grass[kb] + wc * W.grass[kc] + wd * W.grass[kd]);
    for (let c = 0; c < 4; c++) this.sp.push(wa * W.splat[ka * 4 + c] + wb * W.splat[kb * 4 + c] + wc * W.splat[kc * 4 + c] + wd * W.splat[kd * 4 + c]);
    return n;
  }

  /** A triangle facing the same way as the terrain triangle (normal `up`). */
  tri(a: number, b: number, c: number, up: P3) {
    const B = this.base;
    const e1x = B[b * 3] - B[a * 3], e1y = B[b * 3 + 1] - B[a * 3 + 1], e1z = B[b * 3 + 2] - B[a * 3 + 2];
    const e2x = B[c * 3] - B[a * 3], e2y = B[c * 3 + 1] - B[a * 3 + 1], e2z = B[c * 3 + 2] - B[a * 3 + 2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    if (nx * up[0] + ny * up[1] + nz * up[2] >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  /**
   * Tessellates one terrain triangle in rows along level contours (every LEVEL m of height), each row split at
   * points aligned across the rows, then zips neighboring rows together. Edge points depend only on the edge.
   */
  triangle(p0: P3, p1: P3, p2: P3) {
    const [V0, V1, V2] = [p0, p1, p2].sort((a, b) => a[1] - b[1]);
    // The plane's upward normal and its uphill gradient.
    const e1 = [V1[0] - V0[0], V1[1] - V0[1], V1[2] - V0[2]], e2 = [V2[0] - V0[0], V2[1] - V0[1], V2[2] - V0[2]];
    let up: P3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (up[1] < 0) up = [-up[0], -up[1], -up[2]];
    const gxT = -up[0] / up[1], gzT = -up[2] / up[1];
    const eps = 1e-4;
    const y0 = V0[1], y1 = V1[1], y2 = V2[1];
    const gl = Math.hypot(gxT, gzT);
    // Along the level: s = position along the contour direction (the same for every row of this triangle).
    const cx = gl > 1e-6 ? -gzT / gl : 1, cz = gl > 1e-6 ? gxT / gl : 0;
    const sOf = (p: P3) => p[0] * cx + p[2] * cz;
    type Row = { ids: number[]; s: number[] };
    const vtx = (p: P3) => this.vertex(p, gxT, gzT);
    const rows: Row[] = [];
    // Bottom: the lowest corner, with the middle one if it's level with it.
    if (y1 - y0 <= eps) rows.push({ ids: [vtx(V0), vtx(V1)], s: [sOf(V0), sOf(V1)] });
    else rows.push({ ids: [vtx(V0)], s: [sOf(V0)] });
    let v1Used = y1 - y0 <= eps || y2 - y1 <= eps;
    const levelRow = (L: number) => {
      const a = edgePoint(V0, V2, L);
      let b: P3;
      if (L < y1 - eps) b = edgePoint(V0, V1, L);
      else if (L > y1 + eps) b = edgePoint(V1, V2, L);
      else {
        b = V1;
        v1Used = true;
      }
      const sa = sOf(a), sb = sOf(b);
      const ids = [vtx(a)], ss = [sa];
      // Points along the row at a global spacing, so rows line up (vertical joints run along them).
      const dir = sb > sa ? 1 : -1;
      const len = Math.abs(sb - sa);
      if (len > 1e-6) {
        let k = dir > 0 ? Math.floor(sa / RES) + 1 : Math.ceil(sa / RES) - 1;
        for (; dir > 0 ? k * RES < sb : k * RES > sb; k += dir) {
          const t = (k * RES - sa) / (sb - sa);
          if (t < 0.25 / Math.max(len / RES, 1) || t > 1 - 0.25 / Math.max(len / RES, 1)) continue;
          ids.push(vtx([a[0] + (b[0] - a[0]) * t, L, a[2] + (b[2] - a[2]) * t]));
          ss.push(k * RES);
        }
      }
      ids.push(vtx(b));
      ss.push(sb);
      return { ids, s: ss };
    };
    const levels: number[] = [];
    for (let k = Math.ceil((y0 + eps) / LEVEL); k * LEVEL < y2 - eps; k++) levels.push(k * LEVEL);
    const rowLevels = [y0];
    for (const L of levels) {
      rows.push(levelRow(L));
      rowLevels.push(L);
    }
    // Top: the highest corner, with the middle one if it's level with it.
    if (y2 - y1 <= eps) rows.push({ ids: [vtx(V2), vtx(V1)], s: [sOf(V2), sOf(V1)] });
    else rows.push({ ids: [vtx(V2)], s: [sOf(V2)] });
    rowLevels.push(y2);
    // The direction s runs from the long edge (V0-V2) toward the short side.
    const sgn = sOf(V1) >= sOf(V0) + (sOf(V2) - sOf(V0)) * ((y1 - y0) / Math.max(y2 - y0, 1e-9)) ? 1 : -1;
    for (let r = 0; r + 1 < rows.length; r++) {
      const lo = { ids: rows[r].ids.slice(), s: rows[r].s.slice() };
      const hi = rows[r + 1];
      // The middle corner sits on the short side of the strip it falls in.
      if (!v1Used && y1 > rowLevels[r] + eps && y1 < rowLevels[r + 1] - eps) {
        lo.ids.push(vtx(V1));
        lo.s.push(sOf(V1));
        v1Used = true;
      }
      let i = 0, j = 0;
      while (i < lo.ids.length - 1 || j < hi.ids.length - 1) {
        const advLo = j >= hi.ids.length - 1 || (i < lo.ids.length - 1 && (lo.s[i + 1] - hi.s[j + 1]) * sgn < 0);
        if (advLo) {
          this.tri(lo.ids[i], hi.ids[j], lo.ids[i + 1], up);
          i++;
        } else {
          this.tri(lo.ids[i], hi.ids[j], hi.ids[j + 1], up);
          j++;
        }
      }
    }
  }
}

function buildTile(req: CliffRequest): CliffTile {
  const h = W.heights;
  const b = new TileBuilder();
  const i0 = req.ti * req.tile, j0 = req.tj * req.tile;
  const i1 = Math.min(i0 + req.tile, N1 - 1), j1 = Math.min(j0 + req.tile, N1 - 1);
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const ka = j * N1 + i, kb = ka + N1, kc = kb + 1, kd = ka + 1;
      if (Math.max(amp[ka], amp[kb], amp[kc], amp[kd]) <= 0.001) continue;
      const x0 = -half + i * cell, z0 = -half + j * cell;
      const A: P3 = [x0, h[ka], z0], B: P3 = [x0, h[kb], z0 + cell], C: P3 = [x0 + cell, h[kc], z0 + cell], D: P3 = [x0 + cell, h[kd], z0];
      // The terrain's two triangles: a-b-d and b-c-d.
      b.triangle(A, B, D);
      b.triangle(B, C, D);
    }
  }
  if (!b.idx.length) return { key: req.key };
  return {
    key: req.key,
    position: new Float32Array(b.pos),
    normal: new Float32Array(b.nor),
    color: new Float32Array(b.col),
    grass: new Float32Array(b.gr),
    splat: new Float32Array(b.sp),
    disp: new Float32Array(b.disp),
    index: new Uint32Array(b.idx),
  };
}

const ctx = self as unknown as { onmessage: (e: MessageEvent) => void; postMessage(m: unknown, t?: Transferable[]): void };
ctx.onmessage = (e: MessageEvent<CliffInit | CliffRequest>) => {
  const msg = e.data;
  if (msg.type === 'init') return init(msg);
  const t = buildTile(msg);
  const transfer = [t.position, t.normal, t.color, t.grass, t.splat, t.disp, t.index].filter(Boolean).map((a) => a!.buffer);
  ctx.postMessage(t, transfer);
};
