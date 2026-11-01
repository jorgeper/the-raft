import * as THREE from 'three';

/**
 * Valheim-style painted sky: a deep blue zenith over a pale cyan horizon, peach-pink-gold toward the sun, soft
 * cumulus lit pink and gold from below at a low sun, high cirrus streaks that glow pink around sunset and in the
 * afterglow, and a large glowing sun disc. Colors come from a table of stops
 * keyed by sun elevation (rose-gold mornings, magenta-violet dusks), so the whole day can be art-directed instead of
 * following a physical model. The same material renders the visible sky and the probe that lights the scene and
 * colors the haze, so ambient light and fog follow the palette automatically.
 *
 * Values are linear HDR before exposure. Keep everything except the sun disc under ~5.5: bloom starts at 6 and a
 * bright sky around the sun would veil the frame (see CLAUDE.md).
 */

type RGB = [number, number, number];
interface Stop {
  /** Sun elevation in degrees. */
  e: number;
  zenith: RGB;
  /** Horizon band away from the sun. */
  horizon: RGB;
  /** Horizon band beneath the sun. */
  sunHorizon: RGB;
  /** Glow around the sun. */
  glow: RGB;
  /** Sunlit side of clouds. */
  cloudLit: RGB;
  /** Shaded underside of clouds. */
  cloudShade: RGB;
  /** High cirrus streaks: white by day, lit pink from below around sunset and in the afterglow after it. */
  wisp: RGB;
}

// Shared by morning and evening once the sun is well up, and at night.
const NIGHT: Stop = {
  e: -18,
  zenith: [0.0026, 0.004, 0.0095],
  horizon: [0.012, 0.019, 0.04],
  sunHorizon: [0.013, 0.02, 0.043],
  glow: [0, 0, 0],
  cloudLit: [0.006, 0.009, 0.02],
  cloudShade: [0.003, 0.005, 0.012],
  wisp: [0.004, 0.006, 0.014],
};
const AFTERNOON: Stop = {
  e: 22,
  zenith: [0.07, 0.6, 2.8],
  horizon: [1.2, 2.5, 3.4],
  sunHorizon: [3.5, 2.65, 1.6],
  glow: [1.8, 1.2, 0.55],
  cloudLit: [4.3, 4.1, 3.8],
  cloudShade: [1.35, 1.75, 2.45],
  wisp: [3.4, 3.5, 3.8],
};
const NOON: Stop = {
  e: 50,
  zenith: [0.06, 0.62, 2.9],
  horizon: [1.25, 2.6, 3.5],
  sunHorizon: [2.6, 3.0, 3.3],
  glow: [1.5, 1.35, 1.05],
  cloudLit: [4.6, 4.5, 4.3],
  cloudShade: [1.5, 1.9, 2.6],
  wisp: [3.6, 3.7, 3.9],
};

/** Dusk: magenta-violet after sunset, deep orange-pink at the horizon, gold at the golden hour. */
const EVENING: Stop[] = [
  NIGHT,
  {
    e: -9,
    zenith: [0.012, 0.016, 0.055],
    horizon: [0.05, 0.045, 0.11],
    sunHorizon: [0.16, 0.07, 0.15],
    glow: [0.06, 0.02, 0.05],
    cloudLit: [0.09, 0.05, 0.12],
    cloudShade: [0.03, 0.03, 0.07],
    wisp: [0.08, 0.04, 0.1],
  },
  {
    e: -3.5,
    zenith: [0.07, 0.07, 0.26],
    horizon: [0.4, 0.26, 0.55],
    sunHorizon: [1.5, 0.48, 0.55],
    glow: [0.7, 0.2, 0.25],
    cloudLit: [1.5, 0.45, 0.6],
    cloudShade: [0.22, 0.16, 0.36],
    wisp: [2.3, 0.6, 1.05],
  },
  {
    e: 1,
    zenith: [0.16, 0.26, 0.95],
    horizon: [1.0, 0.75, 1.15],
    sunHorizon: [4.2, 1.7, 0.75],
    glow: [2.6, 1.0, 0.45],
    cloudLit: [4.2, 1.7, 1.25],
    cloudShade: [0.6, 0.45, 0.85],
    wisp: [3.6, 1.35, 1.4],
  },
  {
    e: 8,
    zenith: [0.15, 0.45, 2.2],
    horizon: [1.45, 1.75, 2.55],
    sunHorizon: [4.3, 2.4, 1.05],
    glow: [2.7, 1.35, 0.55],
    cloudLit: [4.7, 3.2, 2.4],
    cloudShade: [1.0, 1.05, 1.6],
    wisp: [4.0, 2.5, 2.1],
  },
  AFTERNOON,
  NOON,
];

/** Dawn: rose-gold, lighter and less violet than dusk. */
const MORNING: Stop[] = [
  NIGHT,
  {
    e: -9,
    zenith: [0.012, 0.02, 0.06],
    horizon: [0.05, 0.055, 0.11],
    sunHorizon: [0.14, 0.08, 0.12],
    glow: [0.05, 0.025, 0.035],
    cloudLit: [0.08, 0.06, 0.1],
    cloudShade: [0.03, 0.035, 0.07],
    wisp: [0.07, 0.05, 0.09],
  },
  {
    e: -3.5,
    zenith: [0.08, 0.12, 0.32],
    horizon: [0.45, 0.38, 0.6],
    sunHorizon: [1.5, 0.7, 0.62],
    glow: [0.7, 0.32, 0.28],
    cloudLit: [1.6, 0.75, 0.75],
    cloudShade: [0.25, 0.24, 0.42],
    wisp: [2.1, 0.85, 1.0],
  },
  {
    e: 1,
    zenith: [0.2, 0.38, 1.15],
    horizon: [1.1, 1.0, 1.35],
    sunHorizon: [4.2, 2.2, 1.35],
    glow: [2.5, 1.3, 0.75],
    cloudLit: [4.2, 2.3, 1.85],
    cloudShade: [0.75, 0.65, 1.0],
    wisp: [3.7, 1.95, 1.65],
  },
  {
    e: 8,
    zenith: [0.1, 0.55, 2.4],
    horizon: [1.45, 1.95, 2.75],
    sunHorizon: [4.3, 2.8, 1.6],
    glow: [2.6, 1.6, 0.85],
    cloudLit: [4.6, 3.6, 3.0],
    cloudShade: [1.05, 1.2, 1.75],
    wisp: [4.1, 3.0, 2.6],
  },
  AFTERNOON,
  NOON,
];

const KEYS = ['zenith', 'horizon', 'sunHorizon', 'glow', 'cloudLit', 'cloudShade', 'wisp'] as const;

function sample(stops: Stop[], e: number, key: (typeof KEYS)[number], out: THREE.Color) {
  if (e <= stops[0].e) return out.fromArray(stops[0][key]);
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (e <= b.e) {
      const t = THREE.MathUtils.smoothstep(e, a.e, b.e);
      return out.setRGB(
        a[key][0] + (b[key][0] - a[key][0]) * t,
        a[key][1] + (b[key][1] - a[key][1]) * t,
        a[key][2] + (b[key][2] - a[key][2]) * t,
      );
    }
  }
  return out.fromArray(stops[stops.length - 1][key]);
}

/** Height (m) of the cloud layer: sets how fast clouds parallax as you move and where their shadows fall. */
export const CLOUD_HEIGHT = 900;

/** Cloud noise, shared by the sky and the haze pass (which casts the clouds' shadows onto the land). */
export const CLOUD_NOISE = /* glsl */ `
  vec2 hash2(vec2 i) {
    vec3 p = fract(i.xyx * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yzx + 33.33);
    return fract((p.xx + p.yz) * p.zy) * 2.0 - 1.0;
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = dot(hash2(i), f);
    float b = dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
    float c = dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
    float d = dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.6;
  }
  float fbm(vec2 p) {
    float r = 0.0, amp = 0.55;
    for (int i = 0; i < 5; i++) {
      r += amp * noise(p);
      p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3;
      amp *= 0.5;
    }
    return r;
  }

  // Cloud cover at a cloud-layer coordinate (the same field the sky draws).
  float cloudCover(vec2 uv, float clouds) {
    float n = fbm(uv) * 0.5 + 0.5;
    float region = noise(uv * 0.18 + 3.1) * 0.5 + 0.5;
    float cov = clamp(clouds + (region - 0.5) * 0.7, 0.0, 1.0);
    float thr = 1.0 - cov;
    return smoothstep(thr, thr + 0.28, n);
  }
`;

const vertexShader = /* glsl */ `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w; // on the far plane: depth exactly 1.0, which the haze pass reads as sky
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSunHorizon;
  uniform vec3 uGlow;
  uniform vec3 uCloudLit;
  uniform vec3 uCloudShade;
  uniform vec3 uWisp;
  /** Cirrus amount (raised by whimsy). */
  uniform float uWisps;
  /** Valheim's hue split: a lilac-pink stop between the cool sky and the warm sun, instead of a grey RGB blend. */
  uniform float uHueSplit;
  uniform float uOvercast;
  uniform float uSunDisc;
  uniform float uSkyKnee;
  uniform float uSkyCeil;
  uniform float uClouds;
  uniform float uTime;
  /** Cloud drift plus the camera's position over the cloud layer, so clouds are anchored to the world. */
  uniform vec2 uCloudOffset;
  /** Weather and night sky (see weather.ts and main.ts). */
  uniform float uNight;
  uniform vec3 uMoonDir;
  /** 0 = new, 0.5 = full, 1 = new again. */
  uniform float uMoonPhase;
  uniform float uAurora;
  uniform float uMilkyWay;
  varying vec3 vWorldPosition;

  ${CLOUD_NOISE}

  float starHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }

  // The night sky behind the clouds: the Milky Way, aurora curtains, the moon, and now and then a shooting star.
  vec3 nightSky(vec3 d, float y) {
    vec3 c = vec3(0.0);
    // Milky Way: a band of faint light along a great circle tilted across the sky, split by dark dust lanes, with
    // a dense dusting of faint stars in it.
    vec3 gN = normalize(vec3(0.42, 0.5, 0.76));
    vec3 g1 = normalize(cross(gN, vec3(0.0, 1.0, 0.0))), g2 = cross(gN, g1);
    float b = dot(d, gN);
    vec2 gp = vec2(dot(d, g1), dot(d, g2)) * 3.0;
    float band = exp(-b * b * 22.0) * (0.55 + 0.6 * (fbm(gp * 1.3 + 2.0) * 0.5 + 0.5));
    float lanes = smoothstep(0.0, 0.5, fbm(gp * 2.6 + vec2(b * 9.0, 0.0) - 5.0)) * exp(-b * b * 160.0);
    float mw = band * (1.0 - 0.75 * lanes);
    float dense = step(0.9965 - 0.004 * band, starHash(floor(d * 900.0)));
    c += (vec3(0.5, 0.56, 0.85) * mw * 0.035 + vec3(0.9, 0.92, 1.0) * dense * (0.015 + 0.06 * band)) * uMilkyWay;

    // Aurora: curtains hanging over the north, green at the foot fading to violet-pink at the top, slowly folding.
    if (uAurora > 0.0 && y > 0.02) {
      vec2 flatD = normalize(d.xz + 1e-5);
      float north = smoothstep(-0.3, 0.5, dot(flatD, vec2(-0.2, -1.0)));
      vec3 aur = vec3(0.0);
      // Rays run straight up the curtains: keyed to the compass bearing, so they keep their size down to the horizon
      // (keyed to the projected position they aliased into wavy bands there).
      float bearing = atan(d.x, d.z);
      for (int i = 0; i < 10; i++) {
        float h = float(i) / 10.0;
        // Where this view ray crosses a layer of the curtain (higher layers are further out at a given angle).
        vec2 pp = d.xz / (y + 0.05) * (0.35 + h * 0.5);
        float fold = noise(vec2(pp.x * 0.35 + uTime * 0.015, pp.y * 0.12)) * 1.8;
        float line = abs(noise(vec2(pp.x * 0.18 + fold, pp.y * 0.5 - uTime * 0.01)));
        // A bright lower hem, and fine vertical rays shimmering along each fold.
        float rays = smoothstep(-0.3, 0.7, noise(vec2(bearing * 70.0 + fold * 2.0, uTime * 0.25)));
        float curtain = smoothstep(0.09, 0.0, line) * (0.4 + 0.6 * rays);
        vec3 hue = mix(vec3(0.15, 1.0, 0.45), vec3(0.75, 0.25, 0.9), smoothstep(0.35, 0.95, h));
        aur += hue * curtain * (1.0 - h * 0.6);
      }
      c += aur * 0.03 * north * smoothstep(0.07, 0.3, y) * uAurora;
    }

    // Moon: a lit sphere with darker seas; the phase sets which part is lit.
    float cm = dot(d, uMoonDir);
    if (cm > 0.999 && uMoonDir.y > -0.05) {
      vec3 mr = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0))), mu = cross(mr, uMoonDir);
      const float R = 0.0105;
      vec2 q = vec2(dot(d, mr), dot(d, mu)) / R;
      float r2 = dot(q, q);
      if (r2 < 1.0) {
        vec3 n = vec3(q, sqrt(1.0 - r2));
        float a = uMoonPhase * 6.2831853;
        vec3 L = vec3(sin(a), 0.0, -cos(a));
        float lit = smoothstep(-0.04, 0.08, dot(n, L));
        float maria = smoothstep(0.1, 0.6, fbm(q * 1.6 + 4.0) * 0.5 + 0.5);
        float edge = smoothstep(1.0, 0.92, r2);
        c += (vec3(1.0, 0.97, 0.9) * 1.6 * lit * (1.0 - 0.35 * maria) + vec3(0.01, 0.012, 0.02)) * edge;
      }
    }
    float full = 1.0 - abs(uMoonPhase * 2.0 - 1.0);
    c += vec3(0.6, 0.7, 1.0) * (pow(max(cm, 0.0), 300.0) * 0.06 + pow(max(cm, 0.0), 30.0) * 0.008) * full * step(-0.05, uMoonDir.y);

    // A shooting star every few seconds, somewhere up high.
    float slot = floor(uTime / 5.0), tl = fract(uTime / 5.0) * 5.0;
    vec3 hs = vec3(starHash(vec3(slot, 1.7, 3.1)), starHash(vec3(slot, 5.3, 0.7)), starHash(vec3(slot, 2.9, 8.3)));
    if (hs.z < 0.6 && tl < 0.9) {
      vec2 sp = vec2(-2.4 + hs.x * 4.8, 0.45 + hs.y * 0.6);
      vec2 dir = normalize(vec2(hs.x - 0.5 + 0.1, -0.6 - hs.y * 0.4));
      vec2 pd = vec2(atan(d.z, d.x), asin(clamp(d.y, -1.0, 1.0)));
      vec2 head = sp + dir * tl * 0.6;
      vec2 rel = pd - head;
      float along = dot(rel, -dir), across = abs(dot(rel, vec2(-dir.y, dir.x)));
      float trail = step(0.0, along) * (1.0 - smoothstep(0.0, 0.16, along)) * (1.0 - smoothstep(0.0, 0.0018 + along * 0.004, across));
      c += vec3(0.85, 0.9, 1.0) * trail * sin(3.14159 * tl / 0.9) * 0.6;
    }
    return c * uNight;
  }

  void main() {
    vec3 d = normalize(vWorldPosition - cameraPosition);
    float cosT = dot(d, uSunDir);
    float sunUp = smoothstep(-0.25, 0.1, uSunDir.y);
    // Around the horizon: cool on the far side, warm under the sun. A low sun spreads its warmth wider.
    vec2 flatD = normalize(d.xz + 1e-5), flatS = normalize(uSunDir.xz + 1e-5);
    // Clamped: rounding can push it a hair below 0 straight away from the sun, and pow() of that is NaN.
    float toSun = clamp(dot(flatD, flatS) * 0.5 + 0.5, 0.0, 1.0);
    float lowSun = 1.0 - smoothstep(0.05, 0.6, uSunDir.y);
    float warmW = pow(toSun, mix(3.5, 1.6, lowSun));
    vec3 horizon = mix(uHorizon, uSunHorizon, warmW);
    // Blending cyan into peach in RGB passes through grey; Valheim's sky goes blue -> violet-pink -> orange
    // instead. Push the middle of each blend toward magenta (green down, red and blue up), most at a low sun.
    vec3 violet = vec3(1.16, 0.8, 1.1);
    // A grey sky has no violet seam between warm and cool (it showed as pink gaps between the trees in rain).
    float split = uHueSplit * mix(0.35, 1.0, lowSun) * (1.0 - 0.85 * uOvercast);
    horizon *= mix(vec3(1.0), violet, split * 4.0 * warmW * (1.0 - warmW));

    float y = d.y;
    float up = max(y, 0.0);
    // A broad pale band at the horizon fading into the deep blue overhead.
    float upW = smoothstep(0.0, 1.0, pow(up, mix(0.6, 0.45, lowSun)));
    vec3 col = mix(horizon, uZenith, upW);
    // The same violet between the warm horizon and the blue overhead, strongest on the sun's side.
    col *= mix(vec3(1.0), violet, split * 4.0 * upW * (1.0 - upW) * mix(0.4, 1.0, toSun));
    // Warm glow around the sun: a wide soft halo plus a tighter bright one.
    float fwd = max(cosT, 0.0);
    col += uGlow * (mix(0.12, 0.3, lowSun) * pow(fwd, 5.0) + 0.35 * pow(fwd, 40.0) + 0.6 * pow(fwd, 600.0));
    // Below the horizon (seen in reflections and the lighting probe): the horizon haze darkening downward.
    if (y < 0.0) col = mix(col, horizon * 0.55 + uZenith * 0.08, smoothstep(0.0, -0.35, y));

    #ifndef LIGHTING_PROBE
      if (uNight > 0.0 && y > 0.0) col += nightSky(d, y) * (1.0 - uClouds * 0.6);
    #endif

    // High cirrus: thin streaks combed out along the wind, far above the cumulus (so they parallax less and sit
    // behind them). Faint white by day; around sunset they catch the light from below and glow pink, and stay rosy
    // for a while after the sun has set, the way high cloud does.
    if (y > 0.0 && uWisps > 0.0) {
      vec2 cuv = d.xz / (y + 0.06) * 0.55 + uCloudOffset * 0.6;
      // Wind frame: long along x, narrow across.
      vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * cuv;
      // Warp the streaks into hooks and ripples.
      q.y += noise(q * vec2(0.3, 0.5) + 11.0) * 0.8;
      float streak = fbm(q * vec2(0.25, 2.6) + vec2(uTime * 0.003, 0.0)) * 0.5 + 0.5;
      // Fine combing along the streaks.
      float comb = noise(q * vec2(0.5, 16.0) + 4.0) * 0.5 + 0.5;
      // Patches of sky with cirrus, patches without.
      float patchy = smoothstep(0.3, 0.7, noise(cuv * 0.1 - 7.0) * 0.5 + 0.5);
      float wm = smoothstep(0.5, 0.82, streak) * patchy * (0.35 + 0.65 * comb);
      // Thicker and brighter at a low sun; nearly gone in the deep night.
      float show = min(uWisps * mix(0.35, 0.7, lowSun), 1.0);
      // Toward a low sun they're backlit: a deeper rose than the glowing sky behind, with golden edges.
      float back = pow(toSun, 3.0) * lowSun;
      vec3 wisp = uWisp * mix(vec3(1.0), vec3(0.95, 0.55, 0.62), back);
      wisp += uGlow * (pow(fwd, 5.0) * 0.6 + pow(fwd, 40.0) * 0.8) * (1.0 - wm * 0.6 * back);
      wisp = mix(horizon, wisp, smoothstep(0.0, 0.25, y));
      col = mix(col, wisp, wm * show * smoothstep(0.0, 0.06, y));
    }

    // Clouds: a flat layer projected onto the dome, soft and painterly. (In the visible sky the volumetric cloud
    // pass draws them instead when it's on; the probes behind the haze, reflections and ambient keep these.)
    #ifndef VOLUMETRIC_CLOUDS
    if (y > 0.0 && uClouds > 0.0) {
      vec2 uv = d.xz / (y + 0.12) * 0.9 + uCloudOffset;
      float n = fbm(uv) * 0.5 + 0.5;
      float region = noise(uv * 0.18 + 3.1) * 0.5 + 0.5;
      float cov = clamp(uClouds + (region - 0.5) * 0.7, 0.0, 1.0);
      float thr = 1.0 - cov;
      float mask = smoothstep(thr, thr + 0.28, n);
      // Self-shadowing: density a step toward the sun darkens the side facing away from it.
      float n2 = fbm(uv + flatS * 0.09) * 0.5 + 0.5;
      float lit = clamp(0.55 + (n - n2) * 4.0 - (n - thr) * 0.9, 0.0, 1.0);
      lit = mix(lit, 1.0, 0.25 * lowSun);
      vec3 cloud = mix(uCloudShade, uCloudLit, lit);
      // Bright rims toward the sun.
      float edge = mask * (1.0 - mask) * 4.0;
      cloud += uGlow * (pow(fwd, 6.0) * 0.8 + pow(fwd, 60.0) * 1.2) * (0.4 + edge);
      // Distant clouds sink into the horizon haze.
      float fade = smoothstep(0.0, 0.18, y);
      cloud = mix(horizon, cloud, fade);
      col = mix(col, cloud, mask * smoothstep(0.0, 0.05, y) * 0.92);
      fwd *= 1.0 - mask * 0.9;
    }
    #endif

    #ifndef LIGHTING_PROBE
      // Keep the visible sky out of the tone curve's shoulder: past a knee, scale the color down as a whole (hue and
      // saturation kept) toward a ceiling, so a bright horizon reads pale cyan or rose instead of near-white.
      float peak = max(max(col.r, col.g), col.b);
      float over = max(peak - uSkyKnee, 0.0);
      col *= (min(peak, uSkyKnee) + over / (1.0 + over / max(uSkyCeil - uSkyKnee, 1e-3))) / max(peak, 1e-4);
    #endif

    // Big soft sun disc (Valheim's sun reads as a glowing ball, not a pinpoint).
    float disc = smoothstep(0.99985, 0.99993, cosT);
    col += uSunDisc * disc * sunUp * (uGlow + vec3(0.5));

    #ifdef LIGHTING_PROBE
      // The scene's ambient light only (not the visible sky, the haze or reflections). Below the horizon is the
      // land, not haze: grass and earth lit by the sun and the sky bounce a muted olive light up into the shade.
      // Without it a shaded white surface (birch bark, a pale stone) saw blue from above and below and turned
      // cobalt. The sun term is in the probe's units (scene.environmentIntensity 0.34; the sun light is 8) and
      // halved because much of the land around is itself in shade.
      float skyLum = dot(uHorizon + uZenith, vec3(0.2126, 0.7152, 0.0722)) * 0.5;
      vec3 sunOnGround = 7.5 * 0.5 * max(uSunDir.y, 0.0) * sunUp * vec3(1.0, 0.85, 0.65);
      vec3 ground = vec3(0.24, 0.25, 0.13) * (sunOnGround + skyLum);
      col = mix(col, ground, smoothstep(0.0, -0.12, y));
      // A little less saturated than the painted sky: shade stays cool without going electric blue.
      col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), 0.2);
    #endif

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export type SkyUniforms = ReturnType<typeof createSky>['uniforms'];

export function createSky() {
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uWisp: { value: new THREE.Color() },
    uWisps: { value: 0.8 },
    uHueSplit: { value: 1 },
    uOvercast: { value: 0 },
    uSunDisc: { value: 12 },
    /** Soft ceiling on the visible sky's brightest channel (above the knee), so it never tone-maps to white. */
    uSkyKnee: { value: 1.0 },
    uSkyCeil: { value: 1.6 },
    uClouds: { value: 0.38 },
    uTime: { value: 0 },
    uCloudOffset: { value: new THREE.Vector2() },
    uNight: { value: 0 },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonPhase: { value: 0.5 },
    uAurora: { value: 0 },
    uMilkyWay: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    name: 'ValheimSky',
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
  });
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  // The visible sky has its own copy (same uniforms), so it alone can hand its clouds to the volumetric pass.
  const viewMaterial = material.clone();
  viewMaterial.uniforms = uniforms;
  const mesh = new THREE.Mesh(geometry, viewMaterial);
  mesh.frustumCulled = false;
  const probeMesh = new THREE.Mesh(geometry, material);
  /** For the probe while it's baked into the scene's ambient light (PMREM): land below the horizon. */
  const lightingMaterial = material.clone();
  lightingMaterial.uniforms = uniforms;
  lightingMaterial.defines = { LIGHTING_PROBE: '' };

  return {
    mesh,
    probeMesh,
    lightingMaterial,
    /** Use the probe's own material (the visible sky's may leave its clouds to the volumetric pass). */
    probeMaterial: material,
    uniforms,
    /** True when the volumetric cloud pass draws the visible sky's cumulus. */
    setVolumetricClouds(on: boolean) {
      if (on === 'VOLUMETRIC_CLOUDS' in viewMaterial.defines) return;
      if (on) viewMaterial.defines.VOLUMETRIC_CLOUDS = '';
      else delete viewMaterial.defines.VOLUMETRIC_CLOUDS;
      viewMaterial.needsUpdate = true;
    },
    /** Sets the palette for a sun elevation (degrees); `evening` picks the dusk palette over the dawn one. */
    update(sunDir: THREE.Vector3, elevation: number, evening: boolean, clouds: number, overcast = 0) {
      uniforms.uSunDir.value.copy(sunDir);
      uniforms.uClouds.value = clouds;
      uniforms.uOvercast.value = overcast;
      const stops = evening ? EVENING : MORNING;
      const u = uniforms;
      sample(stops, elevation, 'zenith', u.uZenith.value);
      sample(stops, elevation, 'horizon', u.uHorizon.value);
      sample(stops, elevation, 'sunHorizon', u.uSunHorizon.value);
      sample(stops, elevation, 'glow', u.uGlow.value);
      sample(stops, elevation, 'cloudLit', u.uCloudLit.value);
      sample(stops, elevation, 'cloudShade', u.uCloudShade.value);
      sample(stops, elevation, 'wisp', u.uWisp.value);
      if (overcast > 0) {
        // Overcast: the dome flattens into a soft grey-violet, a little warmer under the hidden sun, the glow gone.
        const level = (u.uHorizon.value.r * 0.2126 + u.uHorizon.value.g * 0.7152 + u.uHorizon.value.b * 0.0722) * 0.55;
        const grey = (r: number, g: number, b: number, k: number) => new THREE.Color(r * level * k, g * level * k, b * level * k);
        u.uZenith.value.lerp(grey(0.84, 0.86, 1.0, 0.8), overcast);
        // The horizon only a little brighter than the deck above it: brighter, it showed as a white band under the
        // cloud layer.
        u.uHorizon.value.lerp(grey(0.9, 0.9, 1.0, 0.8), overcast);
        u.uSunHorizon.value.lerp(grey(1.0, 0.94, 0.95, 0.88), overcast);
        u.uGlow.value.multiplyScalar(1 - 0.85 * overcast);
        u.uCloudLit.value.lerp(grey(0.92, 0.92, 1.0, 0.85), overcast);
        u.uCloudShade.value.lerp(grey(0.62, 0.64, 0.76, 0.6), overcast);
        u.uWisp.value.lerp(grey(0.9, 0.9, 1.0, 0.9), overcast);
      }
    },
  };
}
