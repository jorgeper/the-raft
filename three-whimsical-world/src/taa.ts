import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * Temporal anti-aliasing. The camera is nudged by a different sub-pixel offset every frame (`jitter`), and this pass
 * blends the new frame into an accumulated history: each pixel is reprojected through the depth buffer to where it
 * was last frame, and the history there is clipped to the colors around the pixel now, so moving grass and
 * leaves don't smear. It smooths shimmering blades and the noise of the volumetric beams and AO.
 * Without per-object motion vectors, grass swaying in the wind still softens a little, so it's opt-in.
 */
const resolveMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tCurrent: { value: null as THREE.Texture | null },
    tHistory: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uProjInv: { value: new THREE.Matrix4() },
    uViewInv: { value: new THREE.Matrix4() },
    uPrevViewProj: { value: new THREE.Matrix4() },
    uTexel: { value: new THREE.Vector2() },
    /** 1 on the first frame (or after a jump): take the new frame as is. */
    uReset: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tCurrent;
    uniform sampler2D tHistory;
    uniform sampler2D tDepth;
    uniform mat4 uProjInv;
    uniform mat4 uViewInv;
    uniform mat4 uPrevViewProj;
    uniform vec2 uTexel;
    uniform float uReset;
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
      vec3 m1 = vec3(0.0), m2 = vec3(0.0);
      float nearest = 1.0;
      vec2 nearestUv = vUv;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 uv = vUv + vec2(float(x), float(y)) * uTexel;
        vec3 s = toYCoCg(squash(texture2D(tCurrent, uv).rgb));
        m1 += s;
        m2 += s * s;
        float d = texture2D(tDepth, uv).x;
        if (d < nearest) { nearest = d; nearestUv = uv; }
      }
      m1 /= 9.0;
      vec3 sigma = sqrt(max(m2 / 9.0 - m1 * m1, 0.0));

      // Where was this point last frame? (The sky reprojects by direction alone.)
      vec4 ndc = vec4(nearestUv * 2.0 - 1.0, min(nearest, 0.9999999) * 2.0 - 1.0, 1.0);
      vec4 view = uProjInv * ndc;
      vec3 world = (uViewInv * vec4(view.xyz / view.w, 1.0)).xyz;
      vec4 prev = uPrevViewProj * vec4(world, 1.0);
      // The nearest neighbor supplies the motion; apply it to this pixel.
      vec2 prevUv = vUv + (prev.xy / prev.w * 0.5 + 0.5 - nearestUv);
      bool offscreen = any(lessThan(prevUv, vec2(0.0))) || any(greaterThan(prevUv, vec2(1.0))) || prev.w <= 0.0;

      vec3 history = toYCoCg(sampleHistory(prevUv));
      // Variance clipping: pull the history into the box of colors around this pixel now.
      vec3 lo = m1 - sigma, hi = m1 + sigma;
      vec3 c = clamp(history, lo, hi);
      // Fast motion (in pixels) trusts the new frame more; still views accumulate many frames.
      float motion = length((prevUv - vUv) / uTexel);
      float blend = mix(0.1, 0.3, clamp(motion / 6.0, 0.0, 1.0));
      if (offscreen || uReset > 0.5) blend = 1.0;
      vec3 result = mix(fromYCoCg(c), current, blend);
      // The history is kept squashed; unsquash for the frame that moves on down the pipeline.
      gl_FragColor = vec4(result, 1.0);
    }
  `,
  depthTest: false,
  depthWrite: false,
});

/** Hands the resolved frame on, with a light sharpen to win back the crispness the blending costs. */
const copyMaterial = new THREE.ShaderMaterial({
  uniforms: { tSource: { value: null as THREE.Texture | null }, uTexel: { value: new THREE.Vector2() }, uSharpen: { value: 0.18 } },
  vertexShader: resolveMaterial.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tSource;
    uniform vec2 uTexel;
    uniform float uSharpen;
    varying vec2 vUv;
    vec3 unsquash(vec3 c) { return c / max(1.0 - max(c.r, max(c.g, c.b)), 1e-3); }
    void main() {
      vec3 c = texture2D(tSource, vUv).rgb;
      vec3 n = texture2D(tSource, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tSource, vUv - vec2(0.0, uTexel.y)).rgb
        + texture2D(tSource, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tSource, vUv - vec2(uTexel.x, 0.0)).rgb;
      // Sharpened in the squashed space, so bright edges don't ring.
      vec3 s = clamp(c + uSharpen * (4.0 * c - n), 0.0, 0.999);
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
  private history = [this.makeTarget(), this.makeTarget()];
  private current = 0;
  private quad = new FullScreenQuad();
  private frame = 0;
  private prevViewProj = new THREE.Matrix4();
  private prevCamPos = new THREE.Vector3();
  private width = 1;
  private height = 1;
  private jittered = false;
  private resetNext = true;
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
    const jx = halton(this.frame + 1, 2) - 0.5, jy = halton(this.frame + 1, 3) - 0.5;
    this.unjitteredProjInv.copy(this.camera.projectionMatrixInverse);
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
