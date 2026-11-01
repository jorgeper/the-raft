import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * Depth of field for photo mode: a thin-lens circle of confusion from the focal length (the field of view on a
 * full-frame sensor), the f-stop and the focus distance, gathered on a golden-angle spiral over the HDR frame so
 * bright spots open into round bokeh before the bloom. Off (and free) outside photo mode.
 *
 * The depth comes from `DepthCopyPass`, which keeps the scene's distance (water included) as it stands before the
 * haze pass: later in the chain the composer's targets no longer carry a depth buffer.
 */

const fullscreenVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** Copies the depth buffer as linear distance (meters along the view axis) into a float target. */
export class DepthCopyPass extends Pass {
  readonly target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.FloatType, format: THREE.RedFormat, depthBuffer: false });
  private material = new THREE.ShaderMaterial({
    uniforms: { tDepth: { value: null as THREE.Texture | null }, uNear: { value: 0.1 }, uFar: { value: 1000 } },
    vertexShader: fullscreenVertex,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDepth;
      uniform float uNear, uFar;
      varying vec2 vUv;
      void main() {
        float d = texture2D(tDepth, vUv).r;
        gl_FragColor = vec4(uNear * uFar / (uFar - d * (uFar - uNear)), 0.0, 0.0, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  private quad = new FullScreenQuad(this.material);

  constructor(private camera: THREE.PerspectiveCamera) {
    super();
    this.needsSwap = false;
    this.enabled = false;
  }

  setSize(width: number, height: number) {
    this.target.setSize(width, height);
  }

  render(renderer: THREE.WebGLRenderer, _write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    const u = this.material.uniforms;
    u.tDepth.value = read.depthTexture;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
  }

  /** Distance at a screen point (uv 0..1), read back from the GPU; NaN if it can't be read. */
  readDistance(renderer: THREE.WebGLRenderer, u: number, v: number) {
    const out = new Float32Array(4);
    const x = Math.min(Math.max(Math.floor(u * this.target.width), 0), this.target.width - 1);
    const y = Math.min(Math.max(Math.floor(v * this.target.height), 0), this.target.height - 1);
    try {
      renderer.readRenderTargetPixels(this.target, x, y, 1, 1, out);
    } catch {
      return NaN;
    }
    return out[0];
  }
}

export class DofPass extends Pass {
  readonly uniforms = {
    tDiffuse: { value: null as THREE.Texture | null },
    tDist: { value: null as THREE.Texture | null },
    /** Focus distance (m). */
    uFocus: { value: 10 },
    /** Focal length and the lens's aperture diameter (both m), for the thin-lens blur. */
    uFocal: { value: 0.035 },
    uAperture: { value: 0.035 / 2.8 },
    /** Pixels per meter on the sensor (24 mm tall). */
    uPxPerM: { value: 720 / 0.024 },
    /** Largest blur radius, in pixels. */
    uMaxBlur: { value: 24 },
    uRadScale: { value: 1 },
    /** Sky distance: anything past this is at infinity. */
    uFar: { value: 1000 },
  };
  private material = new THREE.ShaderMaterial({
    uniforms: this.uniforms,
    vertexShader: fullscreenVertex,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform sampler2D tDist;
      uniform float uFocus, uFocal, uAperture, uPxPerM, uMaxBlur, uRadScale, uFar;
      varying vec2 vUv;

      // Blur radius (px) of a point at distance d: the thin-lens circle of confusion, as it lands on the sensor.
      float blurAt(float d) {
        d = min(d, uFar * 10.0);
        float c = uAperture * uFocal / max(uFocus - uFocal, 1e-3) * abs(d - uFocus) / d;
        return min(0.5 * c * uPxPerM, uMaxBlur);
      }

      void main() {
        vec2 res = vec2(textureSize(tDiffuse, 0));
        vec3 color = texture2D(tDiffuse, vUv).rgb;
        float centerD = texture2D(tDist, vUv).r;
        float centerSize = blurAt(centerD);
        float tot = 1.0;
        // Golden-angle spiral, denser near the middle; each sample counts if its own blur reaches this pixel. A
        // sharp foreground keeps the blurred background behind it from bleeding over its edges.
        float radius = uRadScale;
        for (int i = 0; i < 220; i++) {
          if (radius >= uMaxBlur) break;
          float ang = float(i) * 2.39996323;
          vec2 tc = vUv + vec2(cos(ang), sin(ang)) * radius / res;
          vec3 sampleColor = texture2D(tDiffuse, tc).rgb;
          float sampleD = texture2D(tDist, tc).r;
          float sampleSize = blurAt(sampleD);
          if (sampleD > centerD) sampleSize = min(sampleSize, centerSize * 2.0);
          float m = smoothstep(radius - 0.5, radius + 0.5, sampleSize);
          color += mix(color / tot, sampleColor, m);
          tot += 1.0;
          radius += uRadScale / radius;
        }
        gl_FragColor = vec4(color / tot, 1.0);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
  private quad = new FullScreenQuad(this.material);

  constructor(depth: DepthCopyPass) {
    super();
    this.uniforms.tDist.value = depth.target.texture;
    this.enabled = false;
  }

  render(renderer: THREE.WebGLRenderer, write: THREE.WebGLRenderTarget, read: THREE.WebGLRenderTarget) {
    this.uniforms.tDiffuse.value = read.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : write);
    this.quad.render(renderer);
  }
}
