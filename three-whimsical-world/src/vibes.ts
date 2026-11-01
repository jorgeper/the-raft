import * as THREE from 'three';

/**
 * Vibes: precanned color moods for the whole world, picked from the panel. "Whimsical" is the look as tuned (the
 * cyan-and-gold Valheim grade): the vibe pass is switched off for it, so it stays pixel for pixel what it was. Every
 * other vibe is one display-space pass after the grade: a soft glow, a hue turn, saturation, a gradient map,
 * lift / gain, contrast, faded blacks, banded light, ink outlines from the depth buffer, grain and a tinted vignette.
 */

export interface Vibe {
  label: string;
  /** Pixel art: the frame in chunky pixels this big (at 720p), colors in `levels` steps per channel, dithered. */
  pixel?: number;
  levels?: number;
  dither?: number;
  /**
   * Low poly: the ground as flat triangles this many meters across, anchored in the world, each one color and lit by
   * its own slope (`facet`: how strongly). Pairs with `paint` to simplify the trees and rocks above it.
   */
  lowPoly?: number;
  facet?: number;
  /** An old projector's flicker, and color fringes toward the corners of a cheap lens. */
  flicker?: number;
  aberration?: number;
  /** Soft glow from the bright parts, in this color (halation, dreamy haze). */
  glow?: number;
  glowColor?: number;
  /** Turns every hue around the color wheel, in degrees (keeps brightness). */
  hue?: number;
  saturation?: number;
  /** Maps brightness onto a three-stop gradient (shade, mids, light), mixed in by `amount`. */
  map?: { low: number; mid: number; high: number; amount: number };
  /** Added to the shade, fading out toward white; and multiplying the light. Per channel. */
  lift?: [number, number, number];
  gain?: [number, number, number];
  contrast?: number;
  /** Raised, tinted blacks, like old print film: black lifts to `fadeColor` (by `fade`, 0..1). */
  fade?: number;
  fadeColor?: number;
  /** Brush strokes (a Kuwahara filter: each pixel takes the calmest of four neighborhoods), 0..1. */
  paint?: number;
  /** Light in this many soft bands (cel shading); 0 = smooth. */
  bands?: number;
  /** Outlines where depth jumps (silhouettes, ridges), in this color. */
  ink?: number;
  inkColor?: number;
  /** Film grain (moving) and paper tooth (still). */
  grain?: number;
  paper?: number;
  vignette?: number;
  vignetteColor?: number;
}

export const VIBES = {
  whimsical: { label: 'Whimsical (cyan & gold)' },
  amethyst: {
    label: 'Amethyst (purple monochrome)',
    glow: 0.3,
    glowColor: 0xe6b8ff,
    map: { low: 0x0a0318, mid: 0x6c34b0, high: 0xf4c4ff, amount: 0.82 },
    contrast: 1.16,
    vignette: 0.3,
    vignetteColor: 0x1a0830,
  },
  honey: {
    label: 'Honey hour (warm gold haze)',
    glow: 0.55,
    glowColor: 0xffc070,
    saturation: 1.08,
    map: { low: 0x24100a, mid: 0xc06a28, high: 0xfff2cc, amount: 0.38 },
    lift: [0.035, 0.018, -0.01],
    gain: [1.1, 1.0, 0.8],
    vignette: 0.3,
    vignetteColor: 0x3a1a08,
  },
  frost: {
    label: 'Frostbound (cold silver blue)',
    glow: 0.25,
    glowColor: 0xe0f0ff,
    saturation: 0.42,
    map: { low: 0x0a1626, mid: 0x6a90ae, high: 0xf2f8ff, amount: 0.42 },
    lift: [0.0, 0.025, 0.06],
    gain: [0.9, 0.98, 1.1],
    contrast: 1.08,
    grain: 0.02,
    vignette: 0.32,
    vignetteColor: 0x0a1424,
  },
  storybook: {
    label: 'Storybook (inked & painted)',
    saturation: 1.2,
    paint: 1,
    bands: 5,
    ink: 0.7,
    inkColor: 0x2b1e16,
    lift: [0.03, 0.025, 0.015],
    contrast: 1.04,
    paper: 0.05,
    vignette: 0.22,
    vignetteColor: 0x4a3420,
  },
  ember: {
    label: 'Ember (red sky at Ragnarök)',
    glow: 0.6,
    glowColor: 0xff7a30,
    saturation: 1.1,
    map: { low: 0x0a0204, mid: 0x9a1c10, high: 0xffd27a, amount: 0.78 },
    contrast: 1.18,
    grain: 0.025,
    vignette: 0.5,
    vignetteColor: 0x000000,
  },
  film: {
    label: 'Old film (faded, grainy)',
    glow: 0.35,
    glowColor: 0xff5a3a,
    hue: -8,
    saturation: 0.72,
    gain: [1.06, 1.0, 0.86],
    contrast: 0.94,
    fade: 1,
    fadeColor: 0x1c2826,
    grain: 0.065,
    vignette: 0.42,
    vignetteColor: 0x100c08,
  },
  otherworld: {
    label: 'Otherworld (alien colors)',
    glow: 0.35,
    glowColor: 0x9affe8,
    hue: -150,
    saturation: 1.25,
    contrast: 1.05,
    vignette: 0.25,
    vignetteColor: 0x10002a,
  },
  horror: {
    label: 'Horror film (bleak, flickering)',
    saturation: 0.22,
    map: { low: 0x000000, mid: 0x323e2c, high: 0xd4dac0, amount: 0.5 },
    lift: [-0.035, -0.03, -0.035],
    gain: [0.9, 0.97, 0.86],
    contrast: 1.32,
    flicker: 0.09,
    aberration: 0.6,
    grain: 0.09,
    vignette: 0.75,
    vignetteColor: 0x000000,
  },
  lowpoly: {
    label: 'Low poly (flat facets)',
    lowPoly: 7,
    facet: 1,
    paint: 1,
    saturation: 1.12,
    contrast: 1.05,
    vignette: 0.18,
    vignetteColor: 0x101820,
  },
  pixel: {
    label: 'Pixel art (chunky, dithered)',
    pixel: 4,
    levels: 6,
    dither: 0.7,
    saturation: 1.25,
    contrast: 1.08,
    ink: 0.55,
    inkColor: 0x1a1024,
  },
} satisfies Record<string, Vibe>;

export type VibeName = keyof typeof VIBES;

// The pass works on display (sRGB) values, so the hex codes are taken as they are, not converted to linear.
const color = (hex: number | undefined, fallback: number) => new THREE.Color().setHex(hex ?? fallback, THREE.LinearSRGBColorSpace);

export const VibeShader = {
  name: 'Vibe',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uTime: { value: 0 },
    /** For low poly: the camera (to find each pixel in the world and project points back), the terrain's heights
     * (`bakeHeights`) and the sun's direction. */
    uProjInv: { value: new THREE.Matrix4() },
    uViewInv: { value: new THREE.Matrix4() },
    uViewProj: { value: new THREE.Matrix4() },
    tHeight: { value: null as THREE.Texture | null },
    uTerrainSize: { value: 2000 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uLowPoly: { value: 0 },
    uPixel: { value: 0 },
    uLevels: { value: 0 },
    uDither: { value: 0 },
    uFacet: { value: 0 },
    uFlicker: { value: 0 },
    uAberration: { value: 0 },
    /** 0 = the whimsical look, 1 = the vibe as designed, up to 1.5 to push it. */
    uStrength: { value: 1 },
    uGlow: { value: 0 },
    uGlowColor: { value: new THREE.Color() },
    uHue: { value: 0 },
    uSaturation: { value: 1 },
    uMapAmount: { value: 0 },
    uMapLow: { value: new THREE.Color() },
    uMapMid: { value: new THREE.Color() },
    uMapHigh: { value: new THREE.Color() },
    uLift: { value: new THREE.Vector3() },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uContrast: { value: 1 },
    uFade: { value: 0 },
    uFadeColor: { value: new THREE.Color() },
    uPaint: { value: 0 },
    uBands: { value: 0 },
    uInk: { value: 0 },
    uInkColor: { value: new THREE.Color() },
    uGrain: { value: 0 },
    uPaper: { value: 0 },
    uVignette: { value: 0 },
    uVignetteColor: { value: new THREE.Color() },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform float uNear, uFar, uTime, uStrength;
    uniform mat4 uProjInv, uViewInv, uViewProj;
    uniform sampler2D tHeight;
    uniform float uTerrainSize; uniform vec3 uSunDir;
    uniform float uPixel, uLevels, uDither, uLowPoly, uFacet, uFlicker, uAberration;
    uniform float uGlow; uniform vec3 uGlowColor;
    uniform float uHue, uSaturation;
    uniform float uMapAmount; uniform vec3 uMapLow, uMapMid, uMapHigh;
    uniform vec3 uLift, uGain;
    uniform float uContrast;
    uniform float uFade; uniform vec3 uFadeColor;
    uniform float uPaint;
    uniform float uBands;
    uniform float uInk; uniform vec3 uInkColor;
    uniform float uGrain, uPaper;
    uniform float uVignette; uniform vec3 uVignetteColor;
    varying vec2 vUv;

    float vHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    float linearDepth(vec2 uv) {
      float d = texture2D(tDepth, uv).r;
      return uNear * uFar / (uFar - d * (uFar - uNear));
    }
    vec3 worldAt(vec2 uv) {
      vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, texture2D(tDepth, uv).r * 2.0 - 1.0, 1.0);
      return (uViewInv * vec4(v.xyz / v.w, 1.0)).xyz;
    }
    float groundAt(vec2 xz) { return texture2D(tHeight, xz / uTerrainSize + 0.5).r; }
    vec3 groundPoint(vec2 xz) { return vec3(xz.x, groundAt(xz), xz.y); }
    // The low-poly lattice, in coordinates sheared so its triangles are the halves of unit squares; back to meters.
    vec2 unshear(vec2 sh, float row, float size) {
      return vec2(sh.x + 0.5 * row + 0.5 * sh.y, row + sh.y) * vec2(size, size * 0.8660254);
    }
    // Adds the scene's color at world point p to sum (w = 1) if p is what the camera sees there; w = 0 when it's
    // hidden or off screen. Either way seen takes the color found there, when on screen.
    float colorAt(vec3 p, float slack, inout vec3 sum, inout vec3 seen) {
      vec4 clip = uViewProj * vec4(p, 1.0);
      if (clip.w <= 0.0) return 0.0;
      vec2 suv = clip.xy / clip.w * 0.5 + 0.5;
      if (any(lessThan(suv, vec2(0.0))) || any(greaterThan(suv, vec2(1.0)))) return 0.0;
      vec3 col = texture2D(tDiffuse, suv).rgb;
      seen = col;
      if (abs(linearDepth(suv) - clip.w) > max(clip.w * 0.1, slack)) return 0.0;
      sum += col;
      return 1.0;
    }
    const float BAYER[16] = float[](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);

    void main() {
      vec2 res = vec2(textureSize(tDiffuse, 0));
      vec3 base = texture2D(tDiffuse, vUv).rgb;
      vec3 c = base;
      // Where depth-based effects look: snapped to the chunky pixel in pixel art.
      vec2 uv = vUv;
      float block = 1.0;
      float facet = 1.0;

      // Pixel art: one color per chunky pixel (the mean of four samples inside it, so it doesn't sparkle).
      if (uPixel > 0.0) {
        block = max(floor(uPixel * res.y / 720.0 + 0.5), 1.0);
        uv = (floor(vUv * res / block) + 0.5) * block / res;
        vec2 o = block * 0.25 / res;
        c = 0.25 * (texture2D(tDiffuse, uv - o).rgb + texture2D(tDiffuse, uv + o).rgb
          + texture2D(tDiffuse, uv + vec2(o.x, -o.y)).rgb + texture2D(tDiffuse, uv + vec2(-o.x, o.y)).rgb);
      }

      // Low poly, anchored in the world so it holds still as you move. The ground (and the grass on it) becomes flat
      // triangles: each takes one color, from the scene where its middle is seen, and the light of its own slope in
      // place of the smooth one.
      bool flatGround = false;
      if (uLowPoly > 0.0 && texture2D(tDepth, vUv).r < 1.0) {
        vec3 w = worldAt(vUv);
        float ground = groundAt(w.xz);
        if (w.y - ground < 1.3 && ground > -0.6) {
          flatGround = true;
          float size = uLowPoly;
          vec2 q = w.xz / vec2(size, size * 0.8660254);
          float row = floor(q.y), fy = fract(q.y);
          float xs = q.x - 0.5 * row - 0.5 * fy;
          float cx = floor(xs);
          bool upper = fract(xs) + fy > 1.0;
          vec3 a = groundPoint(unshear(upper ? vec2(cx + 1.0, 0.0) : vec2(cx, 0.0), row, size));
          vec3 b = groundPoint(unshear(upper ? vec2(cx, 1.0) : vec2(cx + 1.0, 0.0), row, size));
          vec3 e = groundPoint(unshear(upper ? vec2(cx + 1.0, 1.0) : vec2(cx, 1.0), row, size));
          // Sampled at grass-top height: the middle and three points toward the corners, averaging those in view
          // (a trunk or a rise can hide some). With none in view, the middle's color anyway, so the facet stays one.
          vec3 mid = (a + b + e) / 3.0 + vec3(0.0, 0.6, 0.0);
          vec3 sum = vec3(0.0), seen = c;
          float hits = colorAt(mid, 1.5, sum, seen);
          vec3 fallback = seen;
          hits += colorAt(mix(mid, a + vec3(0.0, 0.6, 0.0), 0.5), 1.5, sum, seen);
          hits += colorAt(mix(mid, b + vec3(0.0, 0.6, 0.0), 0.5), 1.5, sum, seen);
          hits += colorAt(mix(mid, e + vec3(0.0, 0.6, 0.0), 0.5), 1.5, sum, seen);
          c = hits > 0.0 ? sum / hits : fallback;
          vec3 n = normalize(cross(b - a, e - a));
          n *= sign(n.y);
          float h = 4.0;
          vec3 smoothN = normalize(vec3(groundAt(w.xz - vec2(h, 0.0)) - groundAt(w.xz + vec2(h, 0.0)), 2.0 * h,
                                        groundAt(w.xz - vec2(0.0, h)) - groundAt(w.xz + vec2(0.0, h))));
          float sunUp = smoothstep(-0.05, 0.15, uSunDir.y);
          float lf = 0.4 + 0.8 * max(dot(n, uSunDir), 0.0), ls = 0.4 + 0.8 * max(dot(smoothN, uSunDir), 0.0);
          facet = clamp(mix(1.0, lf / ls, uFacet * sunUp), 0.5, 1.8);
          facet *= 1.0 + 0.07 * (vHash(vec2(cx, row) + (upper ? 0.37 : 0.0)) - 0.5);
        }
      }

      // A cheap lens: red and blue drift apart toward the corners.
      if (uAberration > 0.0 && uPixel == 0.0 && uLowPoly == 0.0) {
        vec2 off = (vUv - 0.5) * uAberration * 0.012;
        c.r = texture2D(tDiffuse, vUv + off).r;
        c.b = texture2D(tDiffuse, vUv - off).b;
      }
      c *= facet;

      // Brush strokes: of the four 4x4 neighborhoods around the pixel, take the mean of the one with least
      // variance, so flat areas smear into dabs while edges stay crisp.
      // (In low poly, trees and rocks get the strokes; the ground is already flat.)
      if (uPaint > 0.0 && !flatGround) {
        vec3 best = c;
        float bestVar = 1e9;
        for (int q = 0; q < 4; q++) {
          vec2 dir = vec2(q == 1 || q == 3 ? 1.0 : -1.0, q >= 2 ? 1.0 : -1.0);
          vec3 sum = vec3(0.0), sum2 = vec3(0.0);
          for (int j = 0; j < 4; j++) {
            for (int i = 0; i < 4; i++) {
              vec3 s = texture2D(tDiffuse, vUv + dir * vec2(float(i), float(j)) * 1.5 / res).rgb;
              sum += s;
              sum2 += s * s;
            }
          }
          vec3 m = sum / 16.0;
          vec3 v3 = sum2 / 16.0 - m * m;
          float v = v3.r + v3.g + v3.b;
          if (v < bestVar) { bestVar = v; best = m; }
        }
        c = mix(c, best, uPaint);
      }

      // Soft glow: what's bright bleeds into a wide halo, sampled on two rings.
      if (uGlow > 0.0) {
        vec3 halo = vec3(0.0);
        float r = res.y * 0.012;
        for (int i = 0; i < 12; i++) {
          float a = float(i) * 0.5235988 + (i >= 6 ? 0.26 : 0.0);
          vec2 o = vec2(cos(a), sin(a)) * (i >= 6 ? r * 2.2 : r) / res;
          vec3 s = texture2D(tDiffuse, vUv + o).rgb;
          // Only what's really bright glows; the open sky alone shouldn't haze the frame.
          halo += max(s - 0.72, 0.0);
        }
        c += uGlow * uGlowColor * luma(halo / 12.0) * 4.0;
      }

      // Hue turn about the grey axis (Rodrigues), so brightness stays put.
      if (uHue != 0.0) {
        vec3 k = vec3(0.57735);
        float ca = cos(uHue), sa = sin(uHue);
        c = c * ca + cross(k, c) * sa + k * dot(k, c) * (1.0 - ca);
      }
      float l = luma(c);
      c = max(mix(vec3(l), c, uSaturation), 0.0);

      // Gradient map: shade, mids and light each take their vibe's color.
      if (uMapAmount > 0.0) {
        float t = clamp(l, 0.0, 1.0);
        vec3 m = t < 0.5 ? mix(uMapLow, uMapMid, t * 2.0) : mix(uMapMid, uMapHigh, t * 2.0 - 1.0);
        c = mix(c, m, uMapAmount);
      }

      c = uGain * (c + uLift * (1.0 - c));
      c = (c - 0.5) * uContrast + 0.5;
      c = max(c, 0.0);

      // Light in soft bands, as if painted in a few values.
      if (uBands > 0.0) {
        float lb = max(luma(c), 1e-4);
        float x = lb * uBands;
        float q = (floor(x) + smoothstep(0.3, 0.7, fract(x))) / uBands;
        c *= mix(1.0, q / lb, 0.85);
      }

      // Ink where depth jumps: silhouettes against the sky and ridges in front of what's behind them.
      if (uInk > 0.0) {
        vec2 px = max(1.25, block) / res;
        float d0 = linearDepth(uv);
        float dl = linearDepth(uv - vec2(px.x, 0.0)), dr = linearDepth(uv + vec2(px.x, 0.0));
        float dd = linearDepth(uv - vec2(0.0, px.y)), du = linearDepth(uv + vec2(0.0, px.y));
        float nearest = min(min(min(dl, dr), min(dd, du)), d0);
        float jump = (max(max(max(dl, dr), max(dd, du)), d0) - nearest) / nearest;
        // Only edges whose near side is close enough to draw; the far landscape stays a painted backdrop.
        float line = smoothstep(0.12, 0.3, jump) * (1.0 - smoothstep(40.0, 160.0, nearest));
        c = mix(c, uInkColor, line * uInk);
      }

      // Faded print: black rises to the fade color, white stays white.
      if (uFade > 0.0) c = mix(c, uFadeColor + c * (1.0 - uFadeColor), uFade);

      // Moving film grain, and a still paper tooth.
      vec2 pix = floor(vUv * res);
      c += uGrain * (vHash(pix + fract(uTime * 7.3) * 113.0) - 0.5) * (1.2 - luma(c));
      c *= 1.0 - uPaper * (vHash(floor(pix / 2.0)) * 0.6 + vHash(floor(pix / 7.0)) * 0.4);

      // The projector's lamp: a constant unsteady flutter, and now and then a deeper dip.
      if (uFlicker > 0.0) {
        float frame = floor(uTime * 18.0);
        c *= 1.0 - uFlicker * (0.5 * vHash(vec2(frame, 1.7)) + step(0.94, vHash(vec2(frame, 9.1))) * 1.5);
      }

      float v = smoothstep(0.95, 0.3, length((vUv - 0.5) * vec2(1.0, 0.8)));
      c = mix(uVignetteColor, c, mix(1.0 - uVignette, 1.0, v));

      // A small palette: each channel in a few steps, ordered dithering (per chunky pixel) blending between them.
      if (uLevels > 1.0) {
        vec2 cell = floor(vUv * res / block);
        int bi = int(mod(cell.x, 4.0)) + int(mod(cell.y, 4.0)) * 4;
        float threshold = (BAYER[bi] + 0.5) / 16.0 - 0.5;
        float steps = uLevels - 1.0;
        c = floor(clamp(c, 0.0, 1.0) * steps + 0.5 + threshold * uDither) / steps;
      }

      gl_FragColor = vec4(clamp(mix(base, c, uStrength), 0.0, 1.0), 1.0);
    }
  `,
};

/**
 * The terrain's heights as a texture covering the whole map (`size` meters across, centered on the origin), for the
 * low-poly facets. About 0.2 s for a world; done when low poly is first picked and after each new world.
 */
export function bakeHeights(height: (x: number, z: number) => number, size: number, res = 512) {
  const data = new Uint16Array(res * res);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      data[j * res + i] = THREE.DataUtils.toHalfFloat(height(((i + 0.5) / res - 0.5) * size, ((j + 0.5) / res - 0.5) * size));
    }
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Sets the vibe pass's uniforms for `name`; returns false for the whimsical look (the pass should be off). */
export function applyVibe(u: typeof VibeShader.uniforms, name: VibeName) {
  const v: Vibe = VIBES[name] ?? VIBES.whimsical;
  u.uGlow.value = v.glow ?? 0;
  u.uGlowColor.value.copy(color(v.glowColor, 0xffffff));
  u.uHue.value = THREE.MathUtils.degToRad(v.hue ?? 0);
  u.uSaturation.value = v.saturation ?? 1;
  u.uMapAmount.value = v.map?.amount ?? 0;
  u.uMapLow.value.copy(color(v.map?.low, 0));
  u.uMapMid.value.copy(color(v.map?.mid, 0x808080));
  u.uMapHigh.value.copy(color(v.map?.high, 0xffffff));
  u.uLift.value.set(...(v.lift ?? [0, 0, 0]));
  u.uGain.value.set(...(v.gain ?? [1, 1, 1]));
  u.uContrast.value = v.contrast ?? 1;
  u.uFade.value = v.fade ?? 0;
  u.uFadeColor.value.copy(color(v.fadeColor, 0));
  u.uPixel.value = v.pixel ?? 0;
  u.uLevels.value = v.levels ?? 0;
  u.uDither.value = v.dither ?? 0;
  u.uLowPoly.value = v.lowPoly ?? 0;
  u.uFacet.value = v.facet ?? 0;
  u.uFlicker.value = v.flicker ?? 0;
  u.uAberration.value = v.aberration ?? 0;
  u.uPaint.value = v.paint ?? 0;
  u.uBands.value = v.bands ?? 0;
  u.uInk.value = v.ink ?? 0;
  u.uInkColor.value.copy(color(v.inkColor, 0));
  u.uGrain.value = v.grain ?? 0;
  u.uPaper.value = v.paper ?? 0;
  u.uVignette.value = v.vignette ?? 0;
  u.uVignetteColor.value.copy(color(v.vignetteColor, 0));
  return name !== 'whimsical';
}
