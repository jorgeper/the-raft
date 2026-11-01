import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { TERRAIN_SIZE } from './terrain';
import { weatherUniforms, RAIN_RIPPLES } from './weather';

/** How many ripple events (a frog diving, a fish rising) can spread at once. */
const MAX_RIPPLES = 12;
/** Ripple events as (x, z, start time, strength), round robin; the water shader spreads a ring from each. */
const ripples = { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0)) };
let nextRipple = 0;
/** Starts rings spreading on the water at (x, z): `time` on the water's clock (the app timer), `strength` 0..1. */
export function addRipple(x: number, z: number, time: number, strength = 1) {
  ripples.value[nextRipple].set(x, z, time, strength);
  nextRipple = (nextRipple + 1) % MAX_RIPPLES;
}

/** Resolution of the river flow map over the terrain (TERRAIN_SIZE / FLOW_RES ≈ 4 m a texel). */
const FLOW_RES = 512;

/**
 * Translucent water, drawn in its own pass right after the opaque scene so it can see what lies beneath it.
 * The pass copies the scene's color and depth, then draws the water surface over the scene:
 * - refraction: the seabed seen through the surface, bent by the waves and tinted by absorption along the path the
 *   light travels through the water (clear turquoise at the edge, deep blue offshore);
 * - caustics shimmering on the shallow bottom;
 * - screen-space reflections of the land, trees and islands, falling back to the sky probe where the ray leaves
 *   the screen;
 * - soft shorelines: the water thins to nothing at the edge, foam laps in and out, and the sun glitters on the waves.
 */

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  varying vec3 vView;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vView = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  #include <packing>
  uniform float uTime;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform samplerCube uEnv;
  uniform sampler2D tSceneColor;
  uniform sampler2D tSceneDepth;
  uniform vec2 uResolution;
  uniform float uNear;
  uniform float uFar;
  uniform float uHaze;
  uniform float uGlitter;
  uniform mat4 uProj;
  // River flow map over the terrain: rg = flow direction (0.5 + 0.5 d), b = how much this is river water.
  uniform sampler2D tFlow;
  uniform float uRain;
  uniform vec4 uRipples[${MAX_RIPPLES}];
  varying vec3 vWorld;
  ${RAIN_RIPPLES}
  varying vec3 vView;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }

  // Sum of directional waves travelling mostly toward the shore (-x). Returns the height gradient.
  vec2 waveGradient(vec2 p, float t, float fade, float calm) {
    vec2 g = vec2(0.0);
    for (int i = 0; i < 14; i++) {
      float fi = float(i);
      vec2 dir = normalize(vec2(-1.0, 1.1 * sin(fi * 2.37 + 0.5)));
      float wavelength = 22.0 * pow(0.78, fi);
      float k = 6.2831853 / wavelength;
      // Steepness-based amplitude keeps slopes realistic at every scale; the long swell dies down in the shallows.
      float amp = (0.09 * pow(0.9, fi) / k) * mix(1.0, fade, step(4.0, fi)) * mix(calm, 1.0, step(4.0, fi));
      float speed = sqrt(9.81 / k);
      float phase = k * (dot(dir, p) - speed * t) + fi * 1.3;
      g += amp * k * cos(phase) * dir;
    }
    return g;
  }

  // Gradient of a small two-octave height field: the ripples a current drags along.
  float rippleH(vec2 p) { return vnoise(p) + 0.45 * vnoise(p * 2.7 + 5.1); }
  vec2 rippleGrad(vec2 p) {
    float h = rippleH(p);
    return vec2(rippleH(p + vec2(0.12, 0.0)) - h, rippleH(p + vec2(0.0, 0.12)) - h) / 0.12;
  }

  float viewZAt(vec2 uv) {
    return perspectiveDepthToViewZ(texture2D(tSceneDepth, uv).x, uNear, uFar);
  }

  vec2 hash2(vec2 p) {
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
  }
  // Cellular edges: near 1 on the borders between drifting cells, 0 inside them.
  float cellEdges(vec2 p, float t) {
    vec2 i = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 h = hash2(i + o);
      vec2 c = o + 0.5 + 0.4 * sin(t * (0.6 + h) + h * 6.2831) - f;
      float d = dot(c, c);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return 1.0 - smoothstep(0.0, 0.18, sqrt(d2) - sqrt(d1));
  }
  // Caustics: a warped web of bright lines, two layers at different scales.
  float caustics(vec2 p, float t) {
    vec2 w = vec2(vnoise(p * 0.5 + t * 0.1), vnoise(p * 0.5 - t * 0.08 + 7.3)) * 1.3;
    float a = cellEdges(p * 1.3 + w, t);
    float b = cellEdges(p * 2.1 - w.yx + 3.7, t * 1.3);
    return a * 0.7 + a * b * 0.8 + b * 0.25;
  }

  // Screen-space reflection: march the reflected ray in view space against the scene depth.
  // Returns the hit's screen position in xy, its confidence in z (0 = missed) and the distance traveled in w.
  vec4 traceReflection(vec3 P, vec3 R) {
    float t = 0.4, prevT = 0.0;
    for (int i = 0; i < SSR_STEPS; i++) {
      vec3 Q = P + R * t;
      if (Q.z > -uNear) break;
      vec4 clip = uProj * vec4(Q, 1.0);
      vec2 uv = clip.xy / clip.w * 0.5 + 0.5;
      if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) break;
      float diff = viewZAt(uv) - Q.z;
      if (diff > 0.0 && diff < (t - prevT) * 1.2 + 0.2) {
        // Refine between the last two samples.
        float lo = prevT, hi = t;
        for (int k = 0; k < 5; k++) {
          float mid = 0.5 * (lo + hi);
          vec3 M = P + R * mid;
          vec4 c = uProj * vec4(M, 1.0);
          vec2 u = c.xy / c.w * 0.5 + 0.5;
          if (viewZAt(u) - M.z > 0.0) { hi = mid; uv = u; } else lo = mid;
        }
        vec2 edge = min(uv, 1.0 - uv);
        float conf = smoothstep(0.0, 0.08, min(edge.x, edge.y)) * (1.0 - smoothstep(0.6, 1.0, float(i) / float(SSR_STEPS)));
        return vec4(uv, conf, hi);
      }
      prevT = t;
      t = t * 1.2 + 0.25;
    }
    return vec4(0.0);
  }

  void main() {
    vec3 toCam = cameraPosition - vWorld;
    float dist = length(toCam);
    vec3 V = toCam / dist;
    vec2 suv = gl_FragCoord.xy / uResolution;

    // What lies under this pixel: distance along the view ray to the scene, and how deep the bottom is there.
    float sceneZ = viewZAt(suv);
    float rayScale = dist / max(-vView.z, 1e-3);
    float bottomDist = -sceneZ * rayScale;
    // Depths are measured from this surface's own height: the sea at 0, a pond at its level.
    float surfaceY = vWorld.y;
    float depthHere = max(surfaceY - (cameraPosition.y - V.y * bottomDist), 0.0);
    // Ponds (any water above sea level) are sheltered: no swell, only a faint ripple.
    float pond = step(0.3, surfaceY);

    // Fade small waves with distance to avoid aliasing shimmer; keep some roughness far out so the distant sea
    // doesn't mirror the white horizon. The swell flattens in the shallows.
    float fade = mix(0.35, 1.0, 1.0 - smoothstep(40.0, 600.0, dist));
    float calm = smoothstep(0.0, 3.0, depthHere);
    vec2 g = waveGradient(vWorld.xz, uTime, fade, mix(0.25, 1.0, calm) * (1.0 - pond)) * mix(1.0, 0.18, pond);

    // Rivers flow: their ripples drift downstream (two flow-map phases, cross-faded so the drift never snaps back)
    // instead of rolling ashore like the sea's.
    vec4 flowTex = texture2D(tFlow, vWorld.xz / ${TERRAIN_SIZE.toFixed(1)} + 0.5);
    float river = flowTex.b * (1.0 - pond);
    vec2 flowDir = flowTex.rg * 2.0 - 1.0;
    if (river > 0.01) {
      const float PERIOD = 2.5;
      float p0 = fract(uTime / PERIOD), p1 = fract(uTime / PERIOD + 0.5);
      vec2 drift = flowDir * 1.6 * PERIOD;
      vec2 q = vWorld.xz * vec2(0.8, 1.6);
      vec2 ga = rippleGrad(q - drift * p0 * vec2(0.8, 1.6));
      vec2 gb = rippleGrad(q - drift * p1 * vec2(0.8, 1.6) + 7.3);
      vec2 gr = mix(ga, gb, abs(p0 * 2.0 - 1.0)) * 0.09 * fade;
      g = mix(g, gr, river);
    }
    // Rain: rings spreading where the drops land (close by; further out they're too fine to see).
    if (uRain > 0.01) g += rainRipples(vWorld.xz, uTime) * uRain * 0.35 * (1.0 - smoothstep(10.0, 40.0, dist));
    // Rings where something broke the surface: a packet of a few ripples spreading from it and dying away, and a
    // fleck of white water at the start.
    float plop = 0.0;
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      vec4 rp = uRipples[i];
      float age = uTime - rp.z;
      if (age < 0.0 || age > 4.0) continue;
      vec2 rd = vWorld.xz - rp.xy;
      float rr = length(rd);
      float x = rr - (0.08 + age * 0.5);
      if (x > 0.2) continue;
      float packet = exp(-x * x * 28.0) * (1.0 - age / 4.0) / (1.0 + rr * 2.0);
      g += rd / max(rr, 1e-3) * cos(x * 30.0) * packet * rp.w * 0.65;
      plop += exp(-rr * rr * 120.0) * max(0.0, 1.0 - age / 0.5) * rp.w;
    }
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

    // --- Refraction: shift the lookup by the wave normal, more where the water is deeper.
    vec2 tilt = (viewMatrix * vec4(N, 0.0)).xy - (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xy;
    vec2 ruv = suv + tilt * 0.06 * clamp(depthHere * 0.5, 0.0, 1.0) / max(1.0, dist * 0.05);
    float rZ = viewZAt(ruv);
    // Things in front of the water can't be refracted into it.
    if (rZ > vView.z) { ruv = suv; rZ = sceneZ; }
    float rBottom = -rZ * rayScale;
    vec3 bottomPos = cameraPosition - V * rBottom;
    float depthV = max(surfaceY - bottomPos.y, 0.0);
    // Light travels down to the bottom and back up along the view ray.
    float path = max(rBottom - dist, 0.0) + depthV;
    vec3 seabed = texture2D(tSceneColor, ruv).rgb;
    // The scene copy holds the wet sand's glint toward a low sun (or moon), far brighter than lit sand. Under water
    // that glint doesn't exist, and absorbing the red out of it tone-mapped to a cyan blob at the waterline.
    float seabedLuma = dot(seabed, vec3(0.2126, 0.7152, 0.0722));
    seabed *= min(1.0, 2.2 / max(seabedLuma, 1e-4));

    float sunUp = smoothstep(-0.02, 0.15, uSunDir.y);
    float light = clamp(dot(uSunColor, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    // Caustics on the bottom: strongest in the shallows, gone in deep water and at the waterline.
    float caust = caustics(bottomPos.xz * 0.8, uTime) * smoothstep(0.05, 0.5, depthV) * exp(-depthV * 0.3);
    // Faded with distance: far off the web would read as a tiled pool floor.
    seabed *= 1.0 + caust * 1.2 * sunUp * light * (1.0 - smoothstep(25.0, 80.0, dist));

    // Absorption (red first, then green) and in-scattering toward a teal-blue body color.
    // Ponds: murkier than the sea, a deep teal-blue (red fades out fastest).
    vec3 absorb = mix(vec3(0.42, 0.085, 0.06), vec3(1.6, 0.6, 0.7), pond);
    vec3 T = exp(-absorb * path);
    vec3 scatter = mix(vec3(0.012, 0.085, 0.13), vec3(0.012, 0.06, 0.075), pond) * (0.35 + 0.65 * max(uSunDir.y, 0.0)) * (0.1 + 0.9 * light);
    // Shallow water picks up a brighter turquoise from the lit sand beneath it.
    scatter = mix(scatter * vec3(1.6, 2.4, 1.7), scatter, smoothstep(0.5, 6.0, depthV));
    vec3 below = seabed * T + scatter * (1.0 - T);

    // --- Reflection: the scene where the reflected ray hits it, else the sky. The reflection uses a calmer normal
    // than the lighting, so shores and trees stay recognizable in it.
    vec3 Nr = normalize(mix(N, vec3(0.0, 1.0, 0.0), 0.7));
    vec3 R = reflect(-V, Nr);
    R.y = abs(R.y);
    vec3 sky = textureCube(uEnv, R).rgb;
    vec3 refl = sky;
    #if SSR_STEPS > 0
      vec3 Rv = normalize((viewMatrix * vec4(R, 0.0)).xyz);
      vec4 hit = traceReflection(vView, Rv);
      if (hit.z > 0.0) {
        vec3 hitColor = texture2D(tSceneColor, hit.xy).rgb;
        // The copy is from before the haze pass: haze the reflection by how far the reflected ray traveled.
        hitColor = mix(hitColor, textureCube(uEnv, normalize(vec3(R.x, 0.05, R.z))).rgb * 0.8, 1.0 - exp(-uHaze * 1.5 * hit.w));
        refl = mix(sky, hitColor, hit.z);
      }
    #endif
    refl *= 0.72;
    float fresnel = min(0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0), 0.85);
    // At the waterline the film is too thin to reflect much: the edge dissolves instead of drawing a line.
    float edge = smoothstep(0.0, 0.35, depthV);
    fresnel *= edge;

    vec3 col = mix(below, refl, fresnel);
    vec3 Rs = reflect(-V, N);
    float spec = pow(max(dot(Rs, uSunDir), 0.0), 900.0);
    col += uSunColor * spec * 12.0 * edge;

    // Sun glitter: tiny facets catch the sun, sparkling across the path of light toward a low sun.
    if (uGlitter > 0.0) {
      vec2 gp = vWorld.xz * 6.0 + uTime * vec2(1.3, 0.7);
      vec3 Ng = normalize(N + vec3(vnoise(gp) - 0.5, 0.0, vnoise(gp + 17.0) - 0.5) * 0.5);
      float glint = pow(max(dot(reflect(-V, Ng), uSunDir), 0.0), 2500.0);
      float twinkle = step(0.82, hash(floor(gp * 2.0) + floor(uTime * 8.0)));
      col += uSunColor * glint * twinkle * 60.0 * uGlitter * sunUp * (1.0 - smoothstep(60.0, 400.0, dist)) * edge;
    }

    // --- Foam: lapping in and out over the shallows, with bubbly texture rather than flat white.
    float n = vnoise(vWorld.xz * 0.6 + uTime * 0.2) * 0.6 + vnoise(vWorld.xz * 2.3 - uTime * 0.3) * 0.4;
    float swash = 0.1 + 0.12 * (0.5 + 0.5 * sin(uTime * 0.9 + n * 3.0 + vWorld.z * 0.04));
    float bubbles = smoothstep(0.35, 0.75, vnoise(vWorld.xz * 7.0 + n * 2.0) * 0.6 + vnoise(vWorld.xz * 19.0 - uTime * 0.4) * 0.4);
    // Lace: foam full of holes, like the real thing.
    float lace = smoothstep(0.42, 0.62, bubbles * 0.7 + n * 0.5);
    // Bands rolling in over the shallows, thinning out toward the edge where the wave has spent itself.
    float bands = 0.5 + 0.5 * sin(depthV * 12.0 - uTime * 1.4 + n * 4.0);
    float foam = smoothstep(0.03, 0.12, depthV) * (1.0 - smoothstep(0.2, 0.45, depthV)) * smoothstep(0.55, 0.85, bands) * lace;
    // The lapping line: a thin edge of foam riding in and out, clear film behind it.
    float lap = (1.0 - smoothstep(0.0, 0.035, abs(depthV - swash))) * (0.35 + 0.65 * lace);
    foam = max(foam, lap) * smoothstep(0.0, 0.015, depthV) * (1.0 - pond) * (1.0 - river);

    // Surf: lines of breaking waves rolling up the beach. The bottom slope stands in for distance from the shore:
    // the phase follows depth, so crests creep into shallower water and break there, trailing foam seaward.
    float sea = (1.0 - pond) * (1.0 - river);
    float surfPhase = fract(depthV * 1.1 + uTime * 0.13 + n * 0.3);
    float surfZone = smoothstep(0.1, 0.3, depthV) * (1.0 - smoothstep(0.8, 1.7, depthV)) * sea;
    // Broken into sets along the shore, so it isn't one ruled line.
    float sets = smoothstep(0.2, 0.55, vnoise(vWorld.xz * 0.035 + vec2(uTime * 0.02, 0.0)));
    float crest = pow(surfPhase, 6.0) * surfZone * sets;
    // A bright, fairly solid line at the breaking front, tearing into lace behind it.
    float surf = smoothstep(0.82, 0.97, surfPhase) * surfZone * sets * (0.7 + 0.3 * lace) + crest * lace * 0.6;
    // The steep face just ahead of the crest is thin and lit through: a brighter turquoise lip.
    float lip = smoothstep(0.75, 0.97, surfPhase) * (1.0 - smoothstep(0.97, 1.0, surfPhase)) * surfZone * sets;
    col += scatter * vec3(1.5, 2.2, 1.8) * lip * sunUp * (1.0 - crest) * 0.9;
    foam = max(foam, surf);

    // White water in the river: flecks of foam carried downstream over the shallows by the banks. Advected with the
    // same two cross-faded phases as the ripples. (Streaks stretched along a per-pixel flow frame sheared into ruled
    // white lines where the flow turned: the frame was taken against absolute world position.)
    if (river > 0.01) {
      const float FP = 3.0;
      float f0 = fract(uTime / FP), f1 = fract(uTime / FP + 0.5);
      vec2 adv = flowDir * 1.4 * FP;
      vec2 wp = vWorld.xz * 0.9;
      float fa = vnoise(wp - adv * f0 * 0.9) * 0.6 + vnoise(wp * 2.7 - adv * f0 * 2.43 + 3.1) * 0.4;
      float fb = vnoise(wp - adv * f1 * 0.9 + 5.2) * 0.6 + vnoise(wp * 2.7 - adv * f1 * 2.43 + 8.7) * 0.4;
      float flecks = mix(fa, fb, abs(f0 * 2.0 - 1.0));
      float shallow = 1.0 - smoothstep(0.08, 0.45, depthV);
      float white = smoothstep(0.58, 0.82, flecks) * shallow * smoothstep(0.02, 0.06, depthV);
      foam = max(foam, white * (0.4 + 0.6 * lace) * river * 0.75);
    }
    foam = max(foam, min(plop, 1.0) * 0.8);
    vec3 foamColor = vec3(0.85, 0.88, 0.88) * (0.5 + 0.5 * max(uSunDir.y, 0.2)) * (0.08 + 0.92 * light) * 1.6;
    col = mix(col, foamColor, foam * 0.8);

    // Duckweed: a few small rafts of tiny leaves drifting in a pond's shallows and coves; open water stays clear.
    if (pond > 0.5) {
      vec2 dp = vWorld.xz + uTime * vec2(0.02, 0.012);
      float raft = smoothstep(0.66, 0.8, vnoise(dp * 0.35) * 0.65 + vnoise(dp * 1.3) * 0.35) * (1.0 - smoothstep(0.1, 0.5, depthV));
      float specks = smoothstep(0.35, 0.6, vnoise(dp * 9.0) * 0.6 + vnoise(dp * 23.0) * 0.4);
      float duck = clamp(raft * (0.55 + 0.45 * specks), 0.0, 1.0);
      // Lit like the land around it: sun plus a little sky.
      vec3 duckLight = uSunColor * 8.0 * max(uSunDir.y, 0.0) / 3.14159 * sunUp + vec3(0.25, 0.32, 0.4);
      col = mix(col, vec3(0.12, 0.24, 0.05) * mix(0.7, 1.15, specks) * duckLight, duck * 0.85);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Copies the scene's color and depth so the water can sample them while drawing over the scene. */
const copyMaterial = new THREE.ShaderMaterial({
  uniforms: { tColor: { value: null }, tDepth: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor;
    uniform sampler2D tDepth;
    varying vec2 vUv;
    void main() {
      gl_FragColor = texture2D(tColor, vUv);
      gl_FragDepth = texture2D(tDepth, vUv).x;
    }
  `,
  depthTest: true,
  depthWrite: true,
  depthFunc: THREE.AlwaysDepth,
});

const emptyFlow = new THREE.DataTexture(new Uint8Array([128, 128, 0, 255]), 1, 1);
emptyFlow.needsUpdate = true;

/**
 * Bakes the rivers into a flow map: for every texel near a river, the downstream direction of the nearest river's
 * centerline (they all run toward the sea, +x) and how far inside its channel this is.
 */
function bakeFlow(riverCenters: (x: number) => { z: number; width: number }[]) {
  const data = new Uint8Array(FLOW_RES * FLOW_RES * 4);
  const texel = TERRAIN_SIZE / FLOW_RES;
  for (let i = 0; i < FLOW_RES; i++) {
    const x = (i + 0.5) * texel - TERRAIN_SIZE / 2;
    const here = riverCenters(x), ahead = riverCenters(x + 2);
    for (let j = 0; j < FLOW_RES; j++) {
      const z = (j + 0.5) * texel - TERRAIN_SIZE / 2;
      let best = Infinity, k = -1;
      here.forEach((c, n) => {
        const d = Math.abs(z - c.z) - c.width;
        if (d < best) (best = d), (k = n);
      });
      const o = (j * FLOW_RES + i) * 4;
      // Water reaches a few meters past the nominal width where the banks wander out.
      const mask = k < 0 ? 0 : 1 - THREE.MathUtils.smoothstep(best, 2, 12);
      let dx = 2, dz = k < 0 ? 0 : ahead[k].z - here[k].z;
      const len = Math.hypot(dx, dz);
      dx /= len;
      dz /= len;
      data[o] = Math.round((0.5 + 0.5 * dx) * 255);
      data[o + 1] = Math.round((0.5 + 0.5 * dz) * 255);
      data[o + 2] = Math.round(mask * 255);
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, FLOW_RES, FLOW_RES);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function createWater(env: THREE.Texture) {
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 0.95, 0.85) },
    uEnv: { value: env },
    tSceneColor: { value: null as THREE.Texture | null },
    tSceneDepth: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uNear: { value: 0.1 },
    uFar: { value: 20000 },
    /** Haze density, so reflections fade like the land they mirror. */
    uHaze: { value: 0.0006 },
    /** Sparkle of the sun on the waves (whimsy raises it). */
    uGlitter: { value: 1 },
    uProj: { value: new THREE.Matrix4() },
    tFlow: { value: emptyFlow },
    uRain: weatherUniforms.uRain,
    uRipples: ripples,
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, defines: { SSR_STEPS: 32 } });
  const geo = new THREE.PlaneGeometry(20000, 20000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  /** One disc per pond at its water level (the shore terrain hides what reaches past the waterline). */
  const ponds = new THREE.Group();
  return {
    mesh,
    ponds,
    uniforms,
    setPonds(list: { x: number; z: number; radius: number; level: number }[]) {
      for (const c of ponds.children) (c as THREE.Mesh).geometry.dispose();
      ponds.clear();
      for (const p of list) {
        const g = new THREE.CircleGeometry(p.radius * 1.6, 64);
        g.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(g, material);
        m.position.set(p.x, p.level, p.z);
        ponds.add(m);
      }
    },
    /** Rebuilds the river flow map for a new world. */
    setRivers(riverCenters: (x: number) => { z: number; width: number }[]) {
      if (uniforms.tFlow.value !== emptyFlow) uniforms.tFlow.value.dispose();
      uniforms.tFlow.value = bakeFlow(riverCenters);
    },
    /** Reflection march steps (0 = sky reflections only). */
    setReflectionSteps(steps: number) {
      if (material.defines.SSR_STEPS === steps) return;
      material.defines.SSR_STEPS = steps;
      material.needsUpdate = true;
    },
  };
}

export type Water = ReturnType<typeof createWater>;

/** Draws the water over the opaque scene in the composer's read buffer (after a copy it can sample). */
export class WaterPass extends Pass {
  private copy: THREE.WebGLRenderTarget;
  private quad = new FullScreenQuad(copyMaterial);
  /**
   * The scene's depth as it stood before the water and the full-screen passes. Overlays (motes, rain) must test
   * against this, not the composer's own depth: with the TAA on, the overlay draws into the very target whose depth
   * texture it would sample, and the TAA's copy has wiped that depth by then.
   */
  get depth() {
    return this.copy.depthTexture!;
  }
  private scene = new THREE.Scene();

  constructor(private water: Water, private camera: THREE.PerspectiveCamera) {
    super();
    this.needsSwap = false;
    this.copy = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType),
    });
    this.scene.add(water.mesh, water.ponds);
  }

  setSize(width: number, height: number) {
    this.copy.setSize(width, height);
    this.water.uniforms.uResolution.value.set(width, height);
  }

  render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    copyMaterial.uniforms.tColor.value = readBuffer.texture;
    copyMaterial.uniforms.tDepth.value = readBuffer.depthTexture;
    renderer.setRenderTarget(this.copy);
    this.quad.render(renderer);

    const u = this.water.uniforms;
    u.tSceneColor.value = this.copy.texture;
    u.tSceneDepth.value = this.copy.depthTexture;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    u.uProj.value.copy(this.camera.projectionMatrix);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer);
    renderer.render(this.scene, this.camera);
    renderer.autoClear = autoClear;
  }
}
