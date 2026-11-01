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
  uniform float uSunDisc;
  uniform float uSkyKnee;
  uniform float uSkyCeil;
  uniform float uClouds;
  uniform float uTime;
  /** Cloud drift plus the camera's position over the cloud layer, so clouds are anchored to the world. */
  uniform vec2 uCloudOffset;
  varying vec3 vWorldPosition;

  ${CLOUD_NOISE}

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
    float split = uHueSplit * mix(0.35, 1.0, lowSun);
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
    uSunDisc: { value: 12 },
    /** Soft ceiling on the visible sky's brightest channel (above the knee), so it never tone-maps to white. */
    uSkyKnee: { value: 1.0 },
    uSkyCeil: { value: 1.6 },
    uClouds: { value: 0.38 },
    uTime: { value: 0 },
    uCloudOffset: { value: new THREE.Vector2() },
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
      sample(stops, elevation, 'wisp', uniforms.uWisp.value);
    },
  };
}
