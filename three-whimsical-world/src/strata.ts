/**
 * Rock bedding shared by the cliff geometry (`src/cliff-worker.ts`, in JS) and the terrain's shading (GLSL), so the
 * colored bands of stone line up with the ledges the beds weather into. Both sides compute the same numbers: the
 * warp is a few low-frequency sines (precise enough on the GPU at world scale) and each bed's character comes from an
 * integer hash, which is exact in both.
 *
 * `bedCoord` rises by 1 per bed: its integer part numbers the bed, its fraction runs from the bed's base (0) to its
 * top (1). Beds are 1 to 5 m thick, gently warped and dipping across the land.
 */

const BED = 1.7;

export function bedCoord(x: number, y: number, z: number) {
  const b = (y + 3.5 * Math.sin(x * 0.013 + 1.3) * Math.sin(z * 0.011 + 0.4) + 1.6 * Math.sin(x * 0.031 - z * 0.027) + 0.012 * x - 0.008 * z) / BED;
  return b + 0.35 * Math.sin(b * 1.9);
}

function hashU(v: number) {
  let x = v >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}

/** A bed's random value in [0, 1) for a salt (1: color, 2: brightness, 3: how far it stands out). */
export function bedHash(k: number, salt: number) {
  return hashU(((k + 100000) | 0) ^ salt) / 4294967295;
}

export const STRATA_GLSL = /* glsl */ `
  float bedCoord(vec3 p) {
    float b = (p.y + 3.5 * sin(p.x * 0.013 + 1.3) * sin(p.z * 0.011 + 0.4) + 1.6 * sin(p.x * 0.031 - p.z * 0.027)
      + 0.012 * p.x - 0.008 * p.z) / ${BED.toFixed(2)};
    return b + 0.35 * sin(b * 1.9);
  }
  uint strataHashU(uint x) {
    x ^= x >> 16u;
    x *= 0x7feb352du;
    x ^= x >> 15u;
    x *= 0x846ca68bu;
    x ^= x >> 16u;
    return x;
  }
  float bedHash(float k, uint salt) {
    return float(strataHashU(uint(int(k) + 100000) ^ salt)) / 4294967295.0;
  }
`;
