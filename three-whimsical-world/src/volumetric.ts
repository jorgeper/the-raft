import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import type { SunShadows } from './cascades';
import { CLOUD_NOISE, CLOUD_HEIGHT } from './sky';

/**
 * Volumetric sunlight, marched at half resolution: for each view ray, the fraction of its first stretch that sees
 * the sun, through the near and far shadow maps. A quarter of the pixels affords twice the steps of a full-res
 * march at half the cost, and a depth-aware blur smooths away the dithering, so the atmosphere pass can draw the
 * beams strongly without them breaking into noise. That pass upsamples the result with depth weights (see
 * `VIS_UPSAMPLE`), so the shafts stay crisp along trunks.
 *
 * Output: R = sun visibility, G = the depth key (distance along the ray, clamped at the march length), B = whether the
 * visible surface sees the sun, A = how much of the air out to a few kilometers sees the sun past the clouds (the
 * crepuscular rays: shafts of light and shadow fanning from gaps in broken cloud).
 */

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Rays are marched this far at most in the open, less inside a forest (where the beams are close). */
const MARCH_GLSL = /* glsl */ `
  float marchLength(bool isSky, float dist) { return min(isSky ? 160.0 : dist, mix(160.0, 70.0, uForest)); }
`;

const marchMaterial = new THREE.ShaderMaterial({
  name: 'VolumetricMarch',
  defines: { VOL_STEPS: 80 },
  uniforms: {
    tDepth: { value: null as THREE.Texture | null },
    uProjInv: { value: new THREE.Matrix4() },
    uViewInv: { value: new THREE.Matrix4() },
    tShadow: { value: null as THREE.Texture | null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    tShadowFar: { value: null as THREE.Texture | null },
    uShadowMatrixFar: { value: new THREE.Matrix4() },
    uForest: { value: 0 },
    uNoiseOffset: { value: 0 },
    // For the cloud rays (post.ts copies them from the atmosphere pass each frame).
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uClouds: { value: 0 },
    uCloudOffset: { value: new THREE.Vector2() },
    uCloudRays: { value: 0 },
  },
  vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDepth;
    uniform mat4 uProjInv;
    uniform mat4 uViewInv;
    uniform sampler2DShadow tShadow;
    uniform mat4 uShadowMatrix;
    #ifdef HAS_SHADOW_FAR
    uniform sampler2DShadow tShadowFar;
    uniform mat4 uShadowMatrixFar;
    #endif
    uniform float uForest;
    uniform float uNoiseOffset;
    uniform vec3 uSunDir;
    uniform float uClouds;
    uniform vec2 uCloudOffset;
    uniform float uCloudRays;
    varying vec2 vUv;
    ${MARCH_GLSL}
    ${CLOUD_NOISE}

    // The cloud field's coarse shape (the first three octaves of the sky's fbm, same frequencies), enough for rays.
    float coarseCover(vec2 uv) {
      float r = 0.0, amp = 0.55;
      vec2 p = uv;
      for (int i = 0; i < 3; i++) {
        r += amp * noise(p);
        p = mat2(1.6, 1.2, -1.2, 1.6) * p + 7.3;
        amp *= 0.5;
      }
      float n = r * 0.5 + 0.5;
      float region = noise(uv * 0.18 + 3.1) * 0.5 + 0.5;
      float cov = clamp(uClouds + (region - 0.5) * 0.7, 0.0, 1.0);
      float thr = 1.0 - cov;
      return smoothstep(thr, thr + 0.28, n);
    }

    // Air along the ray (out to 3 km, below the cloud base) that sees the sun past the clouds, weighted by the
    // haze's transmittance back to the eye.
    float cloudLitAir(vec3 origin, vec3 dir, float len) {
      const float H = ${CLOUD_HEIGHT.toFixed(1)};
      const int N = 16;
      if (dir.y > 0.0) len = min(len, (H - 120.0 - origin.y) / dir.y);
      if (len <= 1.0) return 1.0;
      float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uNoiseOffset + 0.5);
      float lit = 0.0, wSum = 0.0;
      for (int i = 0; i < N; i++) {
        // Denser steps near the eye, where the shafts are wide on screen.
        float f = (float(i) + jitter) / float(N);
        float t = len * f * f;
        vec3 p = origin + dir * t;
        vec3 q = p + uSunDir * ((H - p.y) / max(uSunDir.y, 0.08));
        vec2 uv = (q.xz - origin.xz) / H * 0.9 + uCloudOffset;
        float w = exp(-0.0007 * t) * (0.2 + f);
        // A harder edge than the ground's cloud shadows: crisp-sided shafts.
        lit += w * (1.0 - smoothstep(0.12, 0.55, coarseCover(uv)));
        wSum += w;
      }
      return lit / wSum;
    }

    float sunVisibility(vec3 origin, vec3 dir, float len) {
      const int STEPS = VOL_STEPS;
      // Interleaved gradient noise: neighbouring pixels start at different offsets, and the blur averages them.
      float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uNoiseOffset);
      float stepLen = len / float(STEPS);
      // Weighted by the haze's transmittance back to the eye, as real in-scattering is: near shafts count more
      // than far ones, so a few beams close by stand out instead of averaging into an even glow.
      float sigma = mix(0.004, 0.014, uForest);
      float lit = 0.0, wSum = 0.0;
      for (int i = 0; i < STEPS; i++) {
        float t = (float(i) + jitter) * stepLen;
        vec3 p = origin + dir * t;
        float w = exp(-sigma * t);
        wSum += w;
        vec4 sc = uShadowMatrix * vec4(p, 1.0);
        vec3 c = sc.xyz / sc.w;
        bool inside = all(greaterThan(c, vec3(0.0))) && all(lessThan(c, vec3(1.0)));
        if (inside) {
          lit += w * texture(tShadow, vec3(c.xy, c.z - 0.0015));
        } else {
          #ifdef HAS_SHADOW_FAR
            vec4 fc = uShadowMatrixFar * vec4(p, 1.0);
            vec3 f = fc.xyz / fc.w;
            bool insideFar = all(greaterThan(f, vec3(0.0))) && all(lessThan(f, vec3(1.0)));
            lit += w * (insideFar ? texture(tShadowFar, vec3(f.xy, f.z - 0.001)) : 1.0);
          #else
            lit += w;
          #endif
        }
      }
      return lit / wSum;
    }

    // Whether the visible surface itself sees the sun (pulled a little toward the eye against acne). The
    // atmosphere pass tints what's in shade toward the sky's blue, as Valheim's shade is.
    float surfaceSun(vec3 p) {
      vec4 sc = uShadowMatrix * vec4(p, 1.0);
      vec3 c = sc.xyz / sc.w;
      if (all(greaterThan(c, vec3(0.0))) && all(lessThan(c, vec3(1.0)))) return texture(tShadow, vec3(c.xy, c.z - 0.002));
      #ifdef HAS_SHADOW_FAR
        vec4 fc = uShadowMatrixFar * vec4(p, 1.0);
        vec3 f = fc.xyz / fc.w;
        if (all(greaterThan(f, vec3(0.0))) && all(lessThan(f, vec3(1.0)))) return texture(tShadowFar, vec3(f.xy, f.z - 0.0015));
      #endif
      return 1.0;
    }

    void main() {
      float depth = texture2D(tDepth, vUv).x;
      bool isSky = depth >= 1.0;
      vec4 ndc = vec4(vUv * 2.0 - 1.0, min(depth, 0.9999999) * 2.0 - 1.0, 1.0);
      vec4 view = uProjInv * ndc;
      vec3 world = (uViewInv * vec4(view.xyz / view.w, 1.0)).xyz;
      vec3 camPos = uViewInv[3].xyz;
      vec3 ray = world - camPos;
      float dist = length(ray);
      float len = marchLength(isSky, dist);
      // Always the full 3 km, whatever stands in front: the field then stays smooth across depth edges (a sky gap
      // between leaves upsampled the leaves' short-ray value as blocks), and the atmosphere pass scales it by the
      // real distance's haze, so near surfaces are barely touched.
      float rays = uCloudRays > 0.0 ? cloudLitAir(camPos, ray / dist, 3000.0) : 1.0;
      gl_FragColor = vec4(sunVisibility(camPos, ray / dist, len), len, isSky ? 1.0 : surfaceSun(world - ray / dist * 0.3), rays);
    }
  `,
  depthTest: false,
  depthWrite: false,
});

/** Separable blur that only mixes pixels whose rays end at a similar distance (so trunks keep their edges). */
const blurMaterial = new THREE.ShaderMaterial({
  name: 'VolumetricBlur',
  uniforms: {
    tVis: { value: null as THREE.Texture | null },
    uDirection: { value: new THREE.Vector2() },
  },
  vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tVis;
    uniform vec2 uDirection;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tVis, vUv);
      // R (air) and A (cloud rays) are blurred wide; B (the surface's own sun) only by its nearest neighbours, to
      // keep shadow edges.
      float sum = c.r, wSum = 1.0, sumB = c.b, wB = 1.0, sumA = c.a;
      for (int i = -4; i <= 4; i++) {
        if (i == 0) continue;
        vec4 s = texture2D(tVis, vUv + uDirection * float(i));
        float wd = exp(-abs(s.g - c.g) / (0.08 * c.g + 0.3));
        float w = exp(-float(i * i) / 12.0) * wd;
        sum += s.r * w;
        sumA += s.a * w;
        wSum += w;
        float w2 = exp(-float(i * i) / 1.5) * wd;
        sumB += s.b * w2;
        wB += w2;
      }
      gl_FragColor = vec4(sum / wSum, c.g, sumB / wB, sumA / wSum);
    }
  `,
  depthTest: false,
  depthWrite: false,
});

/**
 * GLSL for the atmosphere pass: `upsampleVis(uv, key)` reads the half-res visibility at a full-res pixel,
 * weighting the four nearest texels by how close their depth key is to this pixel's (`marchLength`).
 */
export const VIS_UPSAMPLE = /* glsl */ `
  uniform sampler2D tVis;
  uniform vec2 uVisTexel;
  ${MARCH_GLSL}
  // x = the air's sun visibility, y = the visible surface's own, z = the air's light past the clouds (cloud rays).
  vec3 upsampleVis(vec2 uv, float key) {
    vec2 pos = uv / uVisTexel - 0.5;
    vec2 base = floor(pos), f = pos - base;
    vec3 sum = vec3(0.0);
    float wSum = 0.0;
    for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
      vec4 s = texture2D(tVis, (base + vec2(i, j) + 0.5) * uVisTexel);
      float bw = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
      float w = (bw + 1e-3) * exp(-abs(s.g - key) / (0.05 * key + 0.15));
      sum += s.rba * w;
      wSum += w;
    }
    // No texel at a matching depth (a thin twig): take the plain bilinear value.
    return wSum > 1e-4 ? sum / wSum : texture2D(tVis, uv).rba;
  }
  // How much of the air around this pixel sees the sun: two rings of taps across a good part of the screen.
  // Beams are the contrast between lit and shaded air; where nearly all of it is lit there are no beams to draw.
  float litAround(vec2 uv) {
    float aspect = uVisTexel.y / uVisTexel.x;
    float sum = texture2D(tVis, uv).r;
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.785398;
      sum += texture2D(tVis, clamp(uv + vec2(cos(a) / aspect, sin(a)) * 0.1, 0.0, 1.0)).r;
      // The outer ring is turned half a step, so its taps fall between the inner ones.
      sum += texture2D(tVis, clamp(uv + vec2(cos(a + 0.39) / aspect, sin(a + 0.39)) * 0.25, 0.0, 1.0)).r;
    }
    return sum / 17.0;
  }
`;

export class VolumetricPass extends Pass {
  private targetA = this.makeTarget();
  private targetB = this.makeTarget();
  private quad = new FullScreenQuad();
  private fullSize = new THREE.Vector2(1, 1);
  readonly uniforms = marchMaterial.uniforms;
  readonly texel = new THREE.Vector2(1, 1);
  /** True once the sun's shadow map exists and the march has run against it. */
  ready = false;

  constructor(private camera: THREE.PerspectiveCamera, private sun: SunShadows) {
    super();
    this.needsSwap = false;
  }

  private makeTarget() {
    const t = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    // Read texel by texel: the upsample does its own (depth-aware) filtering.
    t.texture.minFilter = t.texture.magFilter = THREE.NearestFilter;
    return t;
  }

  /** The blurred result (the vertical blur writes back into A). */
  get texture() {
    return this.targetA.texture;
  }

  /** Steps along each ray; at half resolution twice the full-res count still costs half as much. */
  setSteps(steps: number) {
    if (marchMaterial.defines.VOL_STEPS !== steps) {
      marchMaterial.defines.VOL_STEPS = steps;
      marchMaterial.needsUpdate = true;
    }
  }

  setSize(width: number, height: number) {
    this.fullSize.set(width, height);
    const w = Math.max(1, Math.ceil(width / 2)), h = Math.max(1, Math.ceil(height / 2));
    this.targetA.setSize(w, h);
    this.targetB.setSize(w, h);
    this.texel.set(1 / w, 1 / h);
  }

  /** Binds the shadow maps (they only exist after the first scene render, and are rebuilt on quality changes). */
  private bindShadows() {
    const u = marchMaterial.uniforms, defines = marchMaterial.defines as Record<string, unknown>;
    const depth = this.sun.near.shadow.map?.depthTexture ?? null;
    const farDepth = this.sun.far.visible ? (this.sun.far.shadow.map?.depthTexture ?? null) : null;
    const hasFar = farDepth !== null;
    if (!depth) return false;
    if (u.tShadow.value !== depth || hasFar !== 'HAS_SHADOW_FAR' in defines || (hasFar && u.tShadowFar.value !== farDepth)) {
      u.tShadow.value = depth;
      u.tShadowFar.value = farDepth;
      if (hasFar) defines.HAS_SHADOW_FAR = '';
      else delete defines.HAS_SHADOW_FAR;
      marchMaterial.needsUpdate = true;
    }
    u.uShadowMatrix.value.copy(this.sun.near.shadow.matrix);
    u.uShadowMatrixFar.value.copy(this.sun.far.shadow.matrix);
    return true;
  }

  render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    // (A sampler2DShadow can't be bound to an empty texture: skip until the sun's map exists.)
    this.ready = this.bindShadows();
    if (!this.ready) return;
    const u = marchMaterial.uniforms;
    u.tDepth.value = readBuffer.depthTexture;
    u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    u.uViewInv.value.copy(this.camera.matrixWorld);
    this.quad.material = marchMaterial;
    renderer.setRenderTarget(this.targetA);
    this.quad.render(renderer);

    this.quad.material = blurMaterial;
    blurMaterial.uniforms.tVis.value = this.targetA.texture;
    blurMaterial.uniforms.uDirection.value.set(this.texel.x, 0);
    renderer.setRenderTarget(this.targetB);
    this.quad.render(renderer);
    blurMaterial.uniforms.tVis.value = this.targetB.texture;
    blurMaterial.uniforms.uDirection.value.set(0, this.texel.y);
    renderer.setRenderTarget(this.targetA);
    this.quad.render(renderer);
  }

  dispose() {
    this.targetA.dispose();
    this.targetB.dispose();
    this.quad.dispose();
  }
}
