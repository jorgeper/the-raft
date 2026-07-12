// The always-solvable guarantee (spec §6.2). Pure — unit-tested.
//
// A pattern is a list of footprint rects: { s, hs, l, hl, jumpable }.
// We sweep clusters front to back tracking the set of lateral intervals the
// player could occupy, shrinking by steering reach between clusters.

import { TRAIL_HALF_WIDTH } from '../world/trail.js';

const PLAYER_HALF = 0.35;
const MIN_GAP = 1.1; // a survivable gap must be at least this wide
const STEER_RATIO = 0.36; // conservative lateral m per forward m (11/30)
const JUMP_AIR_TIME = 0.68;

// speed the player will roughly carry at distance s (v² = v0² + 2·a·s)
export function speedAtDistance(s) {
  return Math.min(30, Math.sqrt(49 + 0.56 * Math.max(0, s)));
}

function subtractInterval(intervals, lo, hi) {
  const out = [];
  for (const [a, b] of intervals) {
    if (hi <= a || lo >= b) { out.push([a, b]); continue; }
    if (lo > a) out.push([a, Math.min(lo, b)]);
    if (hi < b) out.push([Math.max(hi, a), b]);
  }
  return out;
}

function expandIntervals(intervals, by, bound) {
  // widen each interval by steering reach, then merge
  const grown = intervals
    .map(([a, b]) => [Math.max(-bound, a - by), Math.min(bound, b + by)])
    .sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const iv of grown) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([...iv]);
  }
  return merged;
}

function intersect(a, b) {
  const out = [];
  for (const [a0, a1] of a) {
    for (const [b0, b1] of b) {
      const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
      if (hi - lo >= MIN_GAP) out.push([lo, hi]);
    }
  }
  return out;
}

export function verifyPattern(rects, { trailHalf = TRAIL_HALF_WIDTH } = {}) {
  if (rects.length === 0) return true;
  const sorted = [...rects].sort((a, b) => a.s - b.s);

  // cluster rects that arrive together (within 3 m of s)
  const clusters = [];
  for (const r of sorted) {
    const last = clusters[clusters.length - 1];
    if (last && r.s - last.s <= 3) { last.rects.push(r); last.s = Math.max(last.s, r.s); }
    else clusters.push({ s: r.s, rects: [r] });
  }

  let feasible = [[-trailHalf, trailHalf]];
  let prevS = clusters[0].s - 60; // generous run-up into the chunk
  let lastForcedJumpS = -Infinity;

  for (const cluster of clusters) {
    const ds = Math.max(0, cluster.s - prevS);
    const reach = ds * STEER_RATIO + 0.001;
    const reachable = expandIntervals(feasible, reach, trailHalf);

    // gaps around every solid rect — jumpable ones still block steering;
    // the jump branch below is what rescues all-jumpable clusters
    let gaps = [[-trailHalf, trailHalf]];
    for (const r of cluster.rects) {
      gaps = subtractInterval(gaps, r.l - r.hl - PLAYER_HALF, r.l + r.hl + PLAYER_HALF);
    }
    let next = intersect(reachable, gaps);

    if (next.length === 0) {
      // steering alone fails — allowed if a jump clears the cluster and the
      // previous forced jump is at least one full jump cycle behind (spec §6.2)
      const v = speedAtDistance(cluster.s);
      const jumpCycle = v * JUMP_AIR_TIME;
      const allJumpable = cluster.rects.every((r) => r.jumpable);
      // one jump arc must clear the whole blocked span, takeoff to landing
      const spanLo = Math.min(...cluster.rects.map((r) => r.s - r.hs));
      const spanHi = Math.max(...cluster.rects.map((r) => r.s + r.hs));
      const clearable = jumpCycle >= spanHi - spanLo + 1.2;
      if (allJumpable && clearable && cluster.s - lastForcedJumpS >= jumpCycle) {
        lastForcedJumpS = cluster.s;
        next = reachable.filter(([a, b]) => b - a >= MIN_GAP);
      }
    }

    if (next.length === 0) return false;
    feasible = next;
    prevS = cluster.s;
  }
  return true;
}
