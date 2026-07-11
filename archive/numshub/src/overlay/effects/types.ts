// The effect renderer contract (SPEC6 FR-A1). Deliberately small and stable —
// this is also the future plugin interface, so keep it frozen-ish.
//
// Color rule: every draw color comes from `frame.colors` (resolved from the
// active theme's CSS variables). Effects express transparency/glow through
// ctx.globalAlpha / shadowBlur + shadowColor — never by inventing colors.
// U8 enforces this at the source level (no color literals in effect modules).

export interface EffectColors {
  /** --nh-fx-primary */
  primary: string;
  /** --nh-fx-accent */
  accent: string;
  /** --nh-fx-glow */
  glow: string;
}

export interface EffectFrame {
  /** Latest mic level, 0..1. */
  level: number;
  /** Rolling history, oldest first (same buffer the classic bars used). */
  levels: readonly number[];
  /** Seconds since the effect was initialized. */
  time: number;
  /** Seconds since the previous frame. */
  dt: number;
  colors: EffectColors;
  reducedMotion: boolean;
  width: number;
  height: number;
}

export interface EffectRenderer {
  init(ctx: CanvasRenderingContext2D, width: number, height: number): void;
  render(ctx: CanvasRenderingContext2D, frame: EffectFrame): void;
  dispose(): void;
}

export interface EffectDef {
  id: string;
  name: string;
  create(): EffectRenderer;
}

// Shared math helpers (no colors in here — theme owns all color).
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Deterministic pseudo-random for stable particle layouts. */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
