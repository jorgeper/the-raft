/**
 * Seasons, picked in the panel (or `?season=autumn`):
 *
 * - Spring (the default): fresh yellow-green grass and meadow, and blossom (pink-white) on many bushes and a share
 *   of the ash, aspen and rowan (whose berries wait for late summer).
 * - Summer: high summer, deep and saturated: dark lush crowns, a deep green meadow with patches sun-dried to gold.
 * - Autumn: every broadleaf tree turned bright gold, orange and red (only the conifers stay green), leaves falling
 *   from the crowns, the meadow rust-orange and most flowers gone to seed.
 * - Winter: snow lies on everything whatever the weather; the broadleaf trees are nearly bare, oaks holding on to
 *   some withered brown leaves, and the grass that pokes through is straw.
 *
 * The shaders read these uniforms (eased, so a change washes over the land in a few seconds); trees also re-mark
 * their instance colors (`Trees.setSeason`).
 */

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

export const seasonUniforms = {
  /** Grass and meadow going tawny, flowers going to seed (0..1). */
  uAutumn: { value: 0 },
  /** Fresh spring green (0..1). */
  uSpring: { value: 0 },
  /** High summer: deep saturated green, hay-gold patches in the meadow (0..1). */
  uSummer: { value: 0 },
  /** How many leaves have fallen from broadleaf trees (0..1, scaled per species). */
  uBare: { value: 0 },
  /** Turned leaves withered to brown (0..1). */
  uWither: { value: 0 },
};

/** Declarations for shaders that read the season. */
export const SEASON_GLSL = /* glsl */ `
  uniform float uAutumn;
  uniform float uSpring;
  uniform float uSummer;
  uniform float uBare;
  uniform float uWither;
`;

/**
 * Where the summer meadow has dried to hay (GLSL, 0..1 over world xz), shared by the blades and the ground beyond
 * them so the patches line up.
 */
export const HAY_PATCH = /* glsl */ `
  float sHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float sNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(sHash(i), sHash(i + vec2(1, 0)), u.x), mix(sHash(i + vec2(0, 1)), sHash(i + vec2(1, 1)), u.x), u.y);
  }
  float hayPatch(vec2 xz) { return smoothstep(0.4, 0.6, sNoise(xz * 0.045) * 0.65 + sNoise(xz * 0.17 + 7.3) * 0.35); }
`;

const TARGETS: Record<Season, { autumn: number; spring: number; summer: number; bare: number; wither: number }> = {
  spring: { autumn: 0, spring: 1, summer: 0, bare: 0, wither: 0 },
  summer: { autumn: 0, spring: 0, summer: 1, bare: 0, wither: 0 },
  autumn: { autumn: 1, spring: 0, summer: 0, bare: 0.12, wither: 0 },
  winter: { autumn: 0.75, spring: 0, summer: 0, bare: 1, wither: 1 },
};

export class Seasons {
  season: Season = 'spring';

  /** Eases the uniforms toward the season (`snap`: at once). */
  update(dt: number, snap = false) {
    const t = TARGETS[this.season];
    const k = snap ? 1 : Math.min(dt / 2.5, 1);
    const u = seasonUniforms;
    u.uAutumn.value += (t.autumn - u.uAutumn.value) * k;
    u.uSpring.value += (t.spring - u.uSpring.value) * k;
    u.uSummer.value += (t.summer - u.uSummer.value) * k;
    u.uBare.value += (t.bare - u.uBare.value) * k;
    u.uWither.value += (t.wither - u.uWither.value) * k;
  }

  /** Snow that lies whatever the weather (winter). */
  get heldSnow() {
    return this.season === 'winter' ? 1 : 0;
  }
}
