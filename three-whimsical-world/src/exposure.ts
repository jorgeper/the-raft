import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const W = 32, H = 18;
/** log2 luminance range stored in the 8-bit probe. */
const LOG_MIN = -16, LOG_RANGE = 24;

/**
 * Meters the frame for eye adaptation: every few frames it reduces the HDR image (before exposure and tone mapping)
 * to a 32×18 grid of log luminance and reads it back asynchronously, so the CPU never waits on the GPU. `average`
 * is the center-weighted geometric mean of the frame's luminance. Passes the image through unchanged.
 */
export class LuminancePass extends Pass {
  /** Center-weighted geometric mean of linear scene luminance; NaN until the first readback lands. */
  average = NaN;
  private target = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false });
  private material = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        // 4×4 taps spread over the patch of the frame this texel stands for.
        float s = 0.0;
        for (int j = 0; j < 4; j++) {
          for (int i = 0; i < 4; i++) {
            vec2 o = (vec2(float(i), float(j)) - 1.5) / 4.0 * vec2(1.0 / ${W}.0, 1.0 / ${H}.0);
            vec3 c = texture2D(tDiffuse, vUv + o).rgb;
            s += log2(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 1e-5));
          }
        }
        gl_FragColor = vec4(clamp((s / 16.0 - (${LOG_MIN}.0)) / ${LOG_RANGE}.0, 0.0, 1.0), 0.0, 0.0, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  private quad = new FullScreenQuad(this.material);
  private pixels = new Uint8Array(W * H * 4);
  private weights = new Float32Array(W * H);
  private pending = false;
  private frame = 0;

  constructor() {
    super();
    this.needsSwap = false;
    // Center-weighted metering: what you look at counts about twice as much as the edges.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        this.weights[y * W + x] = 1 + 1.5 * Math.exp(-(((x - (W - 1) / 2) / (W * 0.3)) ** 2) - ((y - (H - 1) / 2) / (H * 0.3)) ** 2);
      }
    }
  }

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    if (this.frame++ % 4 !== 0 || this.pending) return;
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
    this.pending = true;
    renderer
      .readRenderTargetPixelsAsync(this.target, 0, 0, W, H, this.pixels)
      .then(() => {
        let sum = 0, total = 0;
        for (let i = 0; i < W * H; i++) {
          sum += ((this.pixels[i * 4] / 255) * LOG_RANGE + LOG_MIN) * this.weights[i];
          total += this.weights[i];
        }
        this.average = 2 ** (sum / total);
      })
      .catch(() => {})
      .finally(() => (this.pending = false));
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
