import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { MOTION_SCALE, WIND_DIR } from './wind';

/**
 * Temporal anti-aliasing. The camera is nudged by a different sub-pixel offset every frame (`jitter`), and this pass
 * blends the new frame into an accumulated history: each pixel is reprojected through the depth buffer to where it
 * was last frame, and the history there is clipped to the colors around the pixel now, so moving grass and
 * leaves don't smear. It smooths shimmering blades and the noise of the volumetric beams and AO.
 * Swaying grass and leaves reproject too: the wind materials write how far they moved along the wind since last frame
 * into the frame's alpha (`addWind` in wind.ts), and the point is moved back by that much before reprojecting.
 */
const resolveMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tCurrent: { value: null as THREE.Texture | null },
    tHistory: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    /** Motion of objects that move on their own (`MotionPass`): rg = uv offset to last frame, b = view depth, a = 1. */
    tMotion: { value: null as THREE.Texture | null },
    uMotionOn: { value: 0 },
    uProjInv: { value: new THREE.Matrix4() },
    uViewInv: { value: new THREE.Matrix4() },
    uPrevViewProj: { value: new THREE.Matrix4() },
    uTexel: { value: new THREE.Vector2() },
    /** 1 on the first frame (or after a jump): take the new frame as is. */
    uReset: { value: 1 },
    /** Debug: show the wind motion (red = with the wind, green = against) instead of the frame. */
    uDebugMotion: { value: 0 },
    /** 0 ignores the wind motion (reprojects as if everything stood still), for A/B comparisons. */
    uWindMotion: { value: 1 },
    /**
     * Width of the variance box the history is clipped to, in standard deviations. A tight box (1, and bounded by
     * the neighborhood's min/max) chased each frame's jittered, swaying grass, so the output shimmered: flicker
     * 6.1 standing in the wind vs 3.5 with TAA off (`.playwright-mcp/flicker/`). 1.5 unbounded: 3.9 still, 4.1
     * walking (from 5.5), with no sparkles back along crowns against the sun.
     */
    uGamma: { value: 1.5 },
    /** 1 also bounds the box by the neighborhood's min/max (tighter; shimmers on grass). */
    uMinMax: { value: 0 },
    /**
     * Box width and min/max bounding once a pixel moves (3+ px/frame): tighter, so the history can't trail. The wide
     * still box let running smear grass into streaks with ghost flowers; 1.0 while moving cut ghosting ~25% and
     * flicker ~12% against a no-TAA reference (`.playwright-mcp/move/ghost.js`), with the still view unchanged.
     */
    uGammaMoving: { value: 1.0 },
    uMinMaxMoving: { value: 0 },
    /** Weight of the new frame standing still, and at 6+ px/frame of motion. */
    uBlendStill: { value: 0.1 },
    uBlendMoving: { value: 0.3 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tCurrent;
    uniform sampler2D tHistory;
    uniform sampler2D tDepth;
    uniform sampler2D tMotion;
    uniform float uMotionOn;
    uniform mat4 uProjInv;
    uniform mat4 uViewInv;
    uniform mat4 uPrevViewProj;
    uniform vec2 uTexel;
    uniform float uReset;
    uniform float uDebugMotion;
    uniform float uWindMotion;
    uniform float uGamma;
    uniform float uMinMax;
    uniform float uGammaMoving;
    uniform float uMinMaxMoving;
    uniform float uBlendStill;
    uniform float uBlendMoving;
    varying vec2 vUv;

    vec3 toYCoCg(vec3 c) { return vec3(0.25 * c.r + 0.5 * c.g + 0.25 * c.b, 0.5 * c.r - 0.5 * c.b, -0.25 * c.r + 0.5 * c.g - 0.25 * c.b); }
    vec3 fromYCoCg(vec3 c) { return vec3(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z); }
    // Blend in a compressed space so a few very bright pixels don't dominate (and flicker).
    vec3 squash(vec3 c) { return c / (1.0 + max(c.r, max(c.g, c.b))); }

    // Catmull-Rom history lookup (bilinear taps arranged as a bicubic): keeps the history sharp instead of
    // softening it a little more every frame.
    vec3 sampleHistory(vec2 uv) {
      vec2 size = 1.0 / uTexel;
      vec2 pos = uv * size - 0.5;
      vec2 f = fract(pos);
      vec2 base = (floor(pos) + 0.5) * uTexel;
      vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
      vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
      vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
      vec2 w3 = f * f * (-0.5 + 0.5 * f);
      vec2 w12 = w1 + w2;
      vec2 t0 = base - uTexel, t3 = base + 2.0 * uTexel;
      vec2 t12 = base + (w2 / w12) * uTexel;
      vec3 c = vec3(0.0);
      c += texture2D(tHistory, vec2(t12.x, t0.y)).rgb * w12.x * w0.y;
      c += texture2D(tHistory, vec2(t0.x, t12.y)).rgb * w0.x * w12.y;
      c += texture2D(tHistory, vec2(t12.x, t12.y)).rgb * w12.x * w12.y;
      c += texture2D(tHistory, vec2(t3.x, t12.y)).rgb * w3.x * w12.y;
      c += texture2D(tHistory, vec2(t12.x, t3.y)).rgb * w12.x * w3.y;
      float wSum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
      return max(c / wSum, 0.0);
    }

    void main() {
      vec3 current = squash(texture2D(tCurrent, vUv).rgb);
      // Neighborhood statistics (for clipping the history) and the nearest depth (so edges reproject with the
      // object in front, not the background).
      vec3 m1 = vec3(0.0), m2 = vec3(0.0), mn = vec3(1e9), mx = vec3(-1e9);
      float nearest = 1.0;
      vec2 nearestUv = vUv;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 uv = vUv + vec2(float(x), float(y)) * uTexel;
        vec3 s = toYCoCg(squash(texture2D(tCurrent, uv).rgb));
        m1 += s;
        m2 += s * s;
        mn = min(mn, s);
        mx = max(mx, s);
        float d = texture2D(tDepth, uv).x;
        if (d < nearest) { nearest = d; nearestUv = uv; }
      }
      m1 /= 9.0;
      vec3 sigma = sqrt(max(m2 / 9.0 - m1 * m1, 0.0));

      // Where was this point last frame? (The sky reprojects by direction alone.)
      vec4 ndc = vec4(nearestUv * 2.0 - 1.0, min(nearest, 0.9999999) * 2.0 - 1.0, 1.0);
      vec4 view = uProjInv * ndc;
      vec3 viewPos = view.xyz / view.w;
      vec3 world = (uViewInv * vec4(viewPos, 1.0)).xyz;
      // Wind: last frame this surface stood that far back along the wind (alpha = 1 + motion * scale).
      float wind = nearest < 1.0 ? clamp(texture2D(tCurrent, nearestUv).a - 1.0, -0.9, 0.9) / ${MOTION_SCALE.toFixed(1)} * uWindMotion : 0.0;
      world.xz -= wind * vec2(${WIND_DIR.x.toFixed(6)}, ${WIND_DIR.y.toFixed(6)});
      if (uDebugMotion > 0.5) { gl_FragColor = vec4(max(wind, 0.0) * 40.0, max(-wind, 0.0) * 40.0, 0.0, 1.0); return; }
      vec4 prev = uPrevViewProj * vec4(world, 1.0);
      // The nearest neighbor supplies the motion; apply it to this pixel.
      vec2 prevUv = vUv + (prev.xy / prev.w * 0.5 + 0.5 - nearestUv);
      // A moving object (character, deer, ...) carries its own motion, where it is the surface the scene shows.
      if (uMotionOn > 0.5) {
        vec4 mv = texture2D(tMotion, nearestUv);
        if (mv.a > 0.5 && abs(mv.b + viewPos.z) < 0.05 + 0.02 * mv.b) prevUv = vUv + mv.xy;
      }
      bool offscreen = any(lessThan(prevUv, vec2(0.0))) || any(greaterThan(prevUv, vec2(1.0))) || prev.w <= 0.0;

      vec3 history = toYCoCg(sampleHistory(prevUv));
      float pixels = length((prevUv - vUv) / uTexel);
      float moving = clamp(pixels / 3.0, 0.0, 1.0);
      // Variance clipping: pull the history into the box of colors around this pixel now (see uGamma).
      float gamma = mix(uGamma, uGammaMoving, moving);
      vec3 lo = m1 - gamma * sigma, hi = m1 + gamma * sigma;
      float minMax = max(uMinMax, uMinMaxMoving * moving);
      lo = mix(lo, max(lo, mn), minMax);
      hi = mix(hi, min(hi, mx), minMax);
      vec3 c = clamp(history, lo, hi);
      // Fast motion (in pixels) trusts the new frame more; still views accumulate many frames.
      float blend = mix(uBlendStill, uBlendMoving, clamp(pixels / 6.0, 0.0, 1.0));
      if (offscreen || uReset > 0.5) blend = 1.0;
      vec3 result = mix(fromYCoCg(c), current, blend);
      // Clipping in YCoCg can push a channel past anything in the frame, and unsquashing values near 1 explodes
      // (into bloom blobs along leaves against the sun). Nothing upstream exceeds the haze pass's 6.6 cap.
      result = clamp(result, 0.0, 6.6 / 7.6);
      // The history is kept squashed; unsquash for the frame that moves on down the pipeline.
      // Alpha: how fast this pixel moves, so the copy can sharpen what the resampling softened.
      gl_FragColor = vec4(result, smoothstep(2.0, 8.0, pixels));
    }
  `,
  depthTest: false,
  depthWrite: false,
});

/** Hands the resolved frame on, optionally sharpened (`uSharpen`) to win back the crispness the blending costs. */
const copyMaterial = new THREE.ShaderMaterial({
  // Sharpen off by default: it amplified what's left of the jitter into shimmer on grass (it bought ~10% edge energy).
  // While moving, each frame resamples the history once more and softens it; a sharpen scaled by the pixel's motion
  // wins that back without touching the still view.
  uniforms: {
    tSource: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2() },
    uSharpen: { value: 0 },
    uSharpenMoving: { value: 0.3 },
  },
  vertexShader: resolveMaterial.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tSource;
    uniform vec2 uTexel;
    uniform float uSharpen;
    uniform float uSharpenMoving;
    varying vec2 vUv;
    vec3 unsquash(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-3); }
    void main() {
      vec4 src = texture2D(tSource, vUv);
      vec3 c = src.rgb;
      float sharpen = uSharpen + uSharpenMoving * src.a;
      vec3 n = texture2D(tSource, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tSource, vUv - vec2(0.0, uTexel.y)).rgb
        + texture2D(tSource, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tSource, vUv - vec2(uTexel.x, 0.0)).rgb;
      // Sharpened in the squashed space, so bright edges don't ring. Capped at the haze pass's 6.6 (squashed): a
      // lone bright pixel (sun through a gap in the leaves) overshoots, and unsquashing values near 1 blew it up
      // a thousandfold into a bloom blob.
      vec3 s = clamp(c + sharpen * (4.0 * c - n), 0.0, 6.6 / 7.6);
      gl_FragColor = vec4(unsquash(s), 1.0);
    }
  `,
  depthTest: false,
  depthWrite: false,
});

/** Halton sequence value (base b) for index i, in [0, 1). */
function halton(i: number, b: number) {
  let f = 1, r = 0;
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
}

export class TAAPass extends Pass {
  /** The resolve shader's uniforms (`uDebugMotion` shows the wind motion). */
  readonly uniforms = resolveMaterial.uniforms;
  readonly copyUniforms = copyMaterial.uniforms;
  private history = [this.makeTarget(), this.makeTarget()];
  private current = 0;
  private quad = new FullScreenQuad();
  private frame = 0;
  /** Last frame's unjittered view-projection, and this frame's (set by `jitter`). */
  readonly prevViewProj = new THREE.Matrix4();
  readonly viewProjNow = new THREE.Matrix4();
  /** Per-object motion (a `MotionPass` target), or null. */
  motion: THREE.Texture | null = null;
  private prevCamPos = new THREE.Vector3();
  private width = 1;
  private height = 1;
  private jittered = false;
  private resetNext = true;
  /** Jitter size standing still (1 = ±½ px) and how much of it is left at full speed (for experiments). */
  jitterScale = 1;
  jitterMoving = 1;
  /** The projection without this frame's jitter: reprojection must not chase the jitter. */
  private unjitteredProjInv = new THREE.Matrix4();

  constructor(private camera: THREE.PerspectiveCamera, private depth: THREE.Texture) {
    super();
  }

  private makeTarget() {
    return new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  }

  setSize(width: number, height: number) {
    this.width = width;
    this.height = height;
    for (const t of this.history) t.setSize(width, height);
    this.resetNext = true;
  }

  /** Call before the scene renders: offsets the projection by this frame's sub-pixel jitter. */
  jitter() {
    if (!this.enabled) return;
    this.frame = (this.frame + 1) % 16;
    // Camera speed in m/frame (the camera has already moved this frame); 0.25 is a run.
    const moving = Math.min(this.camera.position.distanceTo(this.prevCamPos) / 0.25, 1);
    const k = this.jitterScale * (1 + (this.jitterMoving - 1) * moving);
    const jx = (halton(this.frame + 1, 2) - 0.5) * k, jy = (halton(this.frame + 1, 3) - 0.5) * k;
    this.unjitteredProjInv.copy(this.camera.projectionMatrixInverse);
    this.viewProjNow.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const p = this.camera.projectionMatrix.elements;
    p[8] += (jx * 2) / this.width;
    p[9] += (jy * 2) / this.height;
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.jittered = true;
  }

  /** Call after the frame: restores the unjittered projection and remembers this view for next frame. */
  endFrame() {
    if (this.jittered) {
      this.camera.updateProjectionMatrix();
      this.jittered = false;
    }
    this.prevViewProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.prevCamPos.copy(this.camera.position);
  }

  /** Throw the history away (after a teleport, or when switching TAA on). */
  reset() {
    this.resetNext = true;
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    // A jump of more than a few meters in one frame is a teleport: start over.
    if (this.camera.position.distanceToSquared(this.prevCamPos) > 25) this.resetNext = true;
    const u = resolveMaterial.uniforms;
    const prev = this.history[this.current], next = this.history[1 - this.current];
    u.tCurrent.value = readBuffer.texture;
    u.tHistory.value = prev.texture;
    u.tDepth.value = this.depth;
    u.tMotion.value = this.motion;
    u.uMotionOn.value = this.motion ? 1 : 0;
    u.uProjInv.value.copy(this.jittered ? this.unjitteredProjInv : this.camera.projectionMatrixInverse);
    u.uViewInv.value.copy(this.camera.matrixWorld);
    u.uPrevViewProj.value.copy(this.prevViewProj);
    u.uTexel.value.set(1 / this.width, 1 / this.height);
    u.uReset.value = this.resetNext ? 1 : 0;
    this.resetNext = false;
    this.quad.material = resolveMaterial;
    renderer.setRenderTarget(next);
    this.quad.render(renderer);

    copyMaterial.uniforms.tSource.value = next.texture;
    copyMaterial.uniforms.uTexel.value.set(1 / this.width, 1 / this.height);
    this.quad.material = copyMaterial;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
    this.current = 1 - this.current;
  }

  dispose() {
    for (const t of this.history) t.dispose();
    this.quad.dispose();
  }
}
