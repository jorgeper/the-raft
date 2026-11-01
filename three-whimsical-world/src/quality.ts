/**
 * Graphics quality presets: one choice scales every expensive part of the frame together.
 * The scene modules read `quality` live (grass, ground cover, motes), and main.ts applies the GPU-side parts
 * (render scale, shadow map, volumetric steps, AO, glow) whenever the preset changes.
 */
export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  /** One line for the panel: what this preset trades away. */
  label: string;
  renderScale: number;
  shadowMapSize: number;
  /** Half-width of the sharp near shadow square around the viewer, meters. */
  shadowExtent: number;
  /** The far shadow cascade toward the horizon: half-width (0 = off) and map size. */
  farShadowExtent: number;
  farShadowMapSize: number;
  /** Fraction of grass blades drawn, and how far grass reaches (m). */
  grassDensity: number;
  grassRadius: number;
  /** Fraction of ferns and flowers drawn, and their reach relative to the default. */
  coverDensity: number;
  coverRadius: number;
  /** Shadow-map samples per pixel for the volumetric sunbeams. */
  volumetricSteps: number;
  /** Ambient occlusion resolution relative to the frame; 0 turns it off. */
  aoScale: number;
  /** Whimsy's wide soft glow pass. */
  glow: boolean;
  /** Fraction of the floating motes and fireflies drawn. */
  motes: number;
  /** Screen-space reflection steps on the water (0 = sky reflections only). */
  waterReflectionSteps: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    label: 'Low: 70% resolution, short grass reach, shadows to 90 m, no AO, glow or land reflections',
    renderScale: 0.7,
    shadowMapSize: 1024,
    shadowExtent: 90,
    farShadowExtent: 0,
    farShadowMapSize: 1024,
    grassDensity: 0.35,
    grassRadius: 60,
    coverDensity: 0.45,
    coverRadius: 0.6,
    volumetricSteps: 12,
    aoScale: 0,
    glow: false,
    motes: 0.3,
    waterReflectionSteps: 0,
  },
  medium: {
    label: 'Medium: 85% resolution, thinner grass, half-res AO',
    renderScale: 0.85,
    shadowMapSize: 2048,
    shadowExtent: 60,
    farShadowExtent: 400,
    farShadowMapSize: 1024,
    grassDensity: 0.6,
    grassRadius: 90,
    coverDensity: 0.7,
    coverRadius: 0.8,
    volumetricSteps: 24,
    aoScale: 0.5,
    glow: true,
    motes: 0.6,
    waterReflectionSteps: 16,
  },
  high: {
    label: 'High: full resolution and detail (the default)',
    renderScale: 1,
    shadowMapSize: 4096,
    shadowExtent: 60,
    farShadowExtent: 600,
    farShadowMapSize: 2048,
    grassDensity: 1,
    grassRadius: 120,
    coverDensity: 1,
    coverRadius: 1,
    volumetricSteps: 40,
    aoScale: 1,
    glow: true,
    motes: 1,
    waterReflectionSteps: 32,
  },
  ultra: {
    label: 'Ultra: 125% supersampling, grass to 150 m, finer beams (slow)',
    renderScale: 1.25,
    shadowMapSize: 4096,
    shadowExtent: 80,
    farShadowExtent: 800,
    farShadowMapSize: 4096,
    grassDensity: 1,
    grassRadius: 150,
    coverDensity: 1,
    coverRadius: 1.25,
    volumetricSteps: 64,
    aoScale: 1,
    glow: true,
    motes: 1,
    waterReflectionSteps: 48,
  },
};

/** The active preset's values; modules read these every frame. */
export const quality: QualityPreset = { ...QUALITY_PRESETS.high };

export function setQuality(level: QualityLevel) {
  Object.assign(quality, QUALITY_PRESETS[level]);
}
