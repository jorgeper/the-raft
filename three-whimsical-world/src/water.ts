import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

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
  varying vec3 vWorld;
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
    float depthHere = max(-(cameraPosition.y - V.y * bottomDist), 0.0);

    // Fade small waves with distance to avoid aliasing shimmer; keep some roughness far out so the distant sea
    // doesn't mirror the white horizon. The swell flattens in the shallows.
    float fade = mix(0.35, 1.0, 1.0 - smoothstep(40.0, 600.0, dist));
    float calm = smoothstep(0.0, 3.0, depthHere);
    vec2 g = waveGradient(vWorld.xz, uTime, fade, mix(0.25, 1.0, calm));
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));

    // --- Refraction: shift the lookup by the wave normal, more where the water is deeper.
    vec2 tilt = (viewMatrix * vec4(N, 0.0)).xy - (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xy;
    vec2 ruv = suv + tilt * 0.06 * clamp(depthHere * 0.5, 0.0, 1.0) / max(1.0, dist * 0.05);
    float rZ = viewZAt(ruv);
    // Things in front of the water can't be refracted into it.
    if (rZ > vView.z) { ruv = suv; rZ = sceneZ; }
    float rBottom = -rZ * rayScale;
    vec3 bottomPos = cameraPosition - V * rBottom;
    float depthV = max(-bottomPos.y, 0.0);
    // Light travels down to the bottom and back up along the view ray.
    float path = max(rBottom - dist, 0.0) + depthV;
    vec3 seabed = texture2D(tSceneColor, ruv).rgb;

    float sunUp = smoothstep(-0.02, 0.15, uSunDir.y);
    float light = clamp(dot(uSunColor, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
    // Caustics on the bottom: strongest in the shallows, gone in deep water and at the waterline.
    float caust = caustics(bottomPos.xz * 0.8, uTime) * smoothstep(0.05, 0.5, depthV) * exp(-depthV * 0.3);
    // Faded with distance: far off the web would read as a tiled pool floor.
    seabed *= 1.0 + caust * 1.2 * sunUp * light * (1.0 - smoothstep(25.0, 80.0, dist));

    // Absorption (red first, then green) and in-scattering toward a teal-blue body color.
    vec3 absorb = vec3(0.42, 0.085, 0.06);
    vec3 T = exp(-absorb * path);
    vec3 scatter = vec3(0.012, 0.085, 0.13) * (0.35 + 0.65 * max(uSunDir.y, 0.0)) * (0.1 + 0.9 * light);
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
    foam = max(foam, lap) * smoothstep(0.0, 0.015, depthV);
    vec3 foamColor = vec3(0.85, 0.88, 0.88) * (0.5 + 0.5 * max(uSunDir.y, 0.2)) * (0.08 + 0.92 * light) * 1.6;
    col = mix(col, foamColor, foam * 0.8);

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
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, defines: { SSR_STEPS: 32 } });
  const geo = new THREE.PlaneGeometry(20000, 20000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return {
    mesh,
    uniforms,
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
  private scene = new THREE.Scene();

  constructor(private water: Water, private camera: THREE.PerspectiveCamera) {
    super();
    this.needsSwap = false;
    this.copy = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.FloatType),
    });
    this.scene.add(water.mesh);
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
