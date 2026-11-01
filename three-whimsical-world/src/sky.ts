import * as THREE from 'three';

/**
 * Valheim-style painted sky: a deep blue zenith over a pale cyan horizon, peach-pink-gold toward the sun, soft
 * cumulus lit pink and gold from below at a low sun, and a large glowing sun disc. Colors come from a table of stops
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
}

// Shared by morning and evening once the sun is well up, and at night.
const NIGHT: Stop = {
  e: -18,
  zenith: [0.0012, 0.0025, 0.008],
  horizon: [0.007, 0.012, 0.028],
  sunHorizon: [0.008, 0.012, 0.03],
  glow: [0, 0, 0],
  cloudLit: [0.006, 0.009, 0.02],
  cloudShade: [0.003, 0.005, 0.012],
};
const AFTERNOON: Stop = {
  e: 22,
  zenith: [0.07, 0.6, 2.8],
  horizon: [1.2, 2.5, 3.4],
  sunHorizon: [3.3, 3.2, 2.8],
  glow: [1.7, 1.45, 1.0],
  cloudLit: [4.3, 4.1, 3.8],
  cloudShade: [1.35, 1.75, 2.45],
};
const NOON: Stop = {
  e: 50,
  zenith: [0.06, 0.62, 2.9],
  horizon: [1.25, 2.6, 3.5],
  sunHorizon: [2.6, 3.0, 3.3],
  glow: [1.5, 1.35, 1.05],
  cloudLit: [4.6, 4.5, 4.3],
  cloudShade: [1.5, 1.9, 2.6],
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
  },
  {
    e: -3.5,
    zenith: [0.07, 0.07, 0.26],
    horizon: [0.4, 0.26, 0.55],
    sunHorizon: [1.5, 0.48, 0.55],
    glow: [0.7, 0.2, 0.25],
    cloudLit: [1.5, 0.45, 0.6],
    cloudShade: [0.22, 0.16, 0.36],
  },
  {
    e: 1,
    zenith: [0.16, 0.26, 0.95],
    horizon: [1.0, 0.75, 1.15],
    sunHorizon: [4.2, 1.7, 0.75],
    glow: [2.6, 1.0, 0.45],
    cloudLit: [4.2, 1.7, 1.25],
    cloudShade: [0.6, 0.45, 0.85],
  },
  {
    e: 8,
    zenith: [0.15, 0.45, 2.2],
    horizon: [1.45, 1.75, 2.55],
    sunHorizon: [4.6, 3.0, 1.6],
    glow: [2.8, 1.75, 0.85],
    cloudLit: [4.7, 3.2, 2.4],
    cloudShade: [1.0, 1.05, 1.6],
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
  },
  {
    e: -3.5,
    zenith: [0.08, 0.12, 0.32],
    horizon: [0.45, 0.38, 0.6],
    sunHorizon: [1.5, 0.7, 0.62],
    glow: [0.7, 0.32, 0.28],
    cloudLit: [1.6, 0.75, 0.75],
    cloudShade: [0.25, 0.24, 0.42],
  },
  {
    e: 1,
    zenith: [0.2, 0.38, 1.15],
    horizon: [1.1, 1.0, 1.35],
    sunHorizon: [4.2, 2.2, 1.35],
    glow: [2.5, 1.3, 0.75],
    cloudLit: [4.2, 2.3, 1.85],
    cloudShade: [0.75, 0.65, 1.0],
  },
  {
    e: 8,
    zenith: [0.1, 0.55, 2.4],
    horizon: [1.45, 1.95, 2.75],
    sunHorizon: [4.5, 3.4, 2.3],
    glow: [2.6, 1.9, 1.2],
    cloudLit: [4.6, 3.6, 3.0],
    cloudShade: [1.05, 1.2, 1.75],
  },
  AFTERNOON,
  NOON,
];

const KEYS = ['zenith', 'horizon', 'sunHorizon', 'glow', 'cloudLit', 'cloudShade'] as const;

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
  uniform float uSunDisc;
  uniform float uClouds;
  uniform float uTime;
  varying vec3 vWorldPosition;

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

  void main() {
    vec3 d = normalize(vWorldPosition - cameraPosition);
    float cosT = dot(d, uSunDir);
    float sunUp = smoothstep(-0.25, 0.1, uSunDir.y);
    // Around the horizon: cool on the far side, warm under the sun. A low sun spreads its warmth wider.
    vec2 flatD = normalize(d.xz + 1e-5), flatS = normalize(uSunDir.xz + 1e-5);
    // Clamped: rounding can push it a hair below 0 straight away from the sun, and pow() of that is NaN.
    float toSun = clamp(dot(flatD, flatS) * 0.5 + 0.5, 0.0, 1.0);
    float lowSun = 1.0 - smoothstep(0.05, 0.6, uSunDir.y);
    vec3 horizon = mix(uHorizon, uSunHorizon, pow(toSun, mix(3.5, 1.6, lowSun)));

    float y = d.y;
    float up = max(y, 0.0);
    // A broad pale band at the horizon fading into the deep blue overhead.
    vec3 col = mix(horizon, uZenith, smoothstep(0.0, 1.0, pow(up, mix(0.6, 0.45, lowSun))));
    // Warm glow around the sun: a wide soft halo plus a tighter bright one.
    float fwd = max(cosT, 0.0);
    col += uGlow * (mix(0.12, 0.3, lowSun) * pow(fwd, 5.0) + 0.35 * pow(fwd, 40.0) + 0.6 * pow(fwd, 600.0));
    // Below the horizon (seen in reflections and the lighting probe): the horizon haze darkening downward.
    if (y < 0.0) col = mix(col, horizon * 0.55 + uZenith * 0.08, smoothstep(0.0, -0.35, y));

    // Clouds: a flat layer projected onto the dome, soft and painterly.
    if (y > 0.0 && uClouds > 0.0) {
      vec2 uv = d.xz / (y + 0.12) * 0.9 + vec2(uTime * 0.004, uTime * 0.0015);
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

    // Big soft sun disc (Valheim's sun reads as a glowing ball, not a pinpoint).
    float disc = smoothstep(0.99985, 0.99993, cosT);
    col += uSunDisc * disc * sunUp * (uGlow + vec3(0.5));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createSky() {
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uCloudLit: { value: new THREE.Color() },
    uCloudShade: { value: new THREE.Color() },
    uSunDisc: { value: 12 },
    uClouds: { value: 0.38 },
    uTime: { value: 0 },
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
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  const probeMesh = new THREE.Mesh(geometry, material);

  return {
    mesh,
    probeMesh,
    uniforms,
    /** Sets the palette for a sun elevation (degrees); `evening` picks the dusk palette over the dawn one. */
    update(sunDir: THREE.Vector3, elevation: number, evening: boolean, clouds: number) {
      uniforms.uSunDir.value.copy(sunDir);
      uniforms.uClouds.value = clouds;
      const stops = evening ? EVENING : MORNING;
      sample(stops, elevation, 'zenith', uniforms.uZenith.value);
      sample(stops, elevation, 'horizon', uniforms.uHorizon.value);
      sample(stops, elevation, 'sunHorizon', uniforms.uSunHorizon.value);
      sample(stops, elevation, 'glow', uniforms.uGlow.value);
      sample(stops, elevation, 'cloudLit', uniforms.uCloudLit.value);
      sample(stops, elevation, 'cloudShade', uniforms.uCloudShade.value);
    },
  };
}
