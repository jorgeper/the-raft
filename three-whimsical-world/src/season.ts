/**
 * Seasons, picked in the panel (or `?season=autumn`):
 *
 * - Spring: fresh yellow-green grass and meadow, and blossom (pink-white) on many bushes and a share
 *   of the ash, aspen and rowan (whose berries wait for late summer).
 * - Summer: the world as it was tuned; a first touch of autumn in drifts here and there.
 * - Autumn: every broadleaf tree turns (aspens gold, ash amber, oaks copper, rowans red), a few leaves already down;
 *   the meadow goes tawny and most flowers have gone to seed.
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
  /** How many leaves have fallen from broadleaf trees (0..1, scaled per species). */
  uBare: { value: 0 },
  /** Turned leaves withered to brown (0..1). */
  uWither: { value: 0 },
};

/** Declarations for shaders that read the season. */
export const SEASON_GLSL = /* glsl */ `
  uniform float uAutumn;
  uniform float uSpring;
  uniform float uBare;
  uniform float uWither;
`;

const TARGETS: Record<Season, { autumn: number; spring: number; bare: number; wither: number }> = {
  spring: { autumn: 0, spring: 1, bare: 0, wither: 0 },
  summer: { autumn: 0, spring: 0, bare: 0, wither: 0 },
  autumn: { autumn: 1, spring: 0, bare: 0.22, wither: 0 },
  winter: { autumn: 0.75, spring: 0, bare: 1, wither: 1 },
};

export class Seasons {
  season: Season = 'summer';

  /** Eases the uniforms toward the season (`snap`: at once). */
  update(dt: number, snap = false) {
    const t = TARGETS[this.season];
    const k = snap ? 1 : Math.min(dt / 2.5, 1);
    const u = seasonUniforms;
    u.uAutumn.value += (t.autumn - u.uAutumn.value) * k;
    u.uSpring.value += (t.spring - u.uSpring.value) * k;
    u.uBare.value += (t.bare - u.uBare.value) * k;
    u.uWither.value += (t.wither - u.uWither.value) * k;
  }

  /** Snow that lies whatever the weather (winter). */
  get heldSnow() {
    return this.season === 'winter' ? 1 : 0;
  }
}
