import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const depthHelpers = /* glsl */ `
  uniform sampler2D tDepth;
  uniform mat4 uProjInv;
  vec3 viewPos(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    return v.xyz / v.w;
  }
`;

/**
 * Depth-only ambient occlusion (Alchemy-style). Works from the final depth buffer,
 * so wind-displaced grass and leaves are occluded where they actually are.
 */
const aoMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tDepth: { value: null },
    uProjInv: { value: new THREE.Matrix4() },
    uProjScale: { value: new THREE.Vector2(1, 1) },
    uRadius: { value: 2.2 },
    uIntensity: { value: 2.5 },
    uFrame: { value: 0 },
  },
  vertexShader,
  fragmentShader: /* glsl */ `
    ${depthHelpers}
    uniform vec2 uProjScale;
    uniform float uRadius;
    uniform float uIntensity;
    varying vec2 vUv;
    const int SAMPLES = 14;

    void main() {
      float d = texture2D(tDepth, vUv).x;
      if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
      vec3 P = viewPos(vUv);
      vec3 N = normalize(cross(dFdx(P), dFdy(P)));
      if (dot(N, P) > 0.0) N = -N;

      // Sample disk sized to the world radius at this depth, rotated per pixel to trade banding for noise.
      vec2 diskUv = uRadius * uProjScale / -P.z * 0.5;
      float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float occlusion = 0.0;
      for (int i = 0; i < SAMPLES; i++) {
        float t = (float(i) + 0.5) / float(SAMPLES);
        float angle = (float(i) + noise) * 2.39996;
        vec2 offset = vec2(cos(angle), sin(angle)) * sqrt(t) * diskUv;
        vec3 v = viewPos(vUv + offset) - P;
        float vv = dot(v, v);
        float falloff = max(1.0 - vv / (uRadius * uRadius), 0.0);
        occlusion += max(dot(v, N) - 0.01 * -P.z, 0.0) / (vv + 0.05) * falloff;
      }
      float ao = max(1.0 - 2.0 * uIntensity * occlusion / float(SAMPLES), 0.0);
      gl_FragColor = vec4(vec3(ao * ao), 1.0);
    }
  `,
});

/** Depth-aware blur so AO noise smooths out without bleeding across silhouettes. */
const blurMaterial = new THREE.ShaderMaterial({
  uniforms: {
    tAO: { value: null },
    tDepth: { value: null },
    uProjInv: { value: new THREE.Matrix4() },
    uDirection: { value: new THREE.Vector2(1, 0) },
  },
  vertexShader,
  fragmentShader: /* glsl */ `
    ${depthHelpers}
    uniform sampler2D tAO;
    uniform vec2 uDirection;
    varying vec2 vUv;
    void main() {
      float z0 = viewPos(vUv).z;
      float sum = 0.0, weight = 0.0;
      for (int i = -4; i <= 4; i++) {
        vec2 uv = vUv + uDirection * float(i);
        float z = viewPos(uv).z;
        float w = exp(-float(i * i) / 12.0) * max(1.0 - abs(z - z0) / (0.05 * abs(z0) + 0.1), 0.0);
        sum += texture2D(tAO, uv).r * w;
        weight += w;
      }
      gl_FragColor = vec4(vec3(sum / max(weight, 1e-4)), 1.0);
    }
  `,
});

/** Computes AO from the scene depth into `texture`; leaves the color buffer untouched. */
export class AOPass extends Pass {
  readonly targetA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  readonly targetB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private quad = new FullScreenQuad();
  private texel = new THREE.Vector2();
  readonly uniforms = aoMaterial.uniforms;

  constructor(private camera: THREE.PerspectiveCamera) {
    super();
    this.needsSwap = false;
  }

  /** Blurred AO; the last blur pass writes into targetA. */
  get texture() {
    return this.targetA.texture;
  }

  setSize(width: number, height: number) {
    this.targetA.setSize(width, height);
    this.targetB.setSize(width, height);
    this.texel.set(1 / width, 1 / height);
  }

  render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget) {
    const depth = readBuffer.depthTexture;
    const proj = this.camera.projectionMatrix.elements;
    aoMaterial.uniforms.tDepth.value = depth;
    aoMaterial.uniforms.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    aoMaterial.uniforms.uProjScale.value.set(proj[0], proj[5]);
    this.quad.material = aoMaterial;
    renderer.setRenderTarget(this.targetA);
    this.quad.render(renderer);

    blurMaterial.uniforms.tDepth.value = depth;
    blurMaterial.uniforms.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    this.quad.material = blurMaterial;
    blurMaterial.uniforms.tAO.value = this.targetA.texture;
    blurMaterial.uniforms.uDirection.value.set(this.texel.x, 0);
    renderer.setRenderTarget(this.targetB);
    this.quad.render(renderer);
    blurMaterial.uniforms.tAO.value = this.targetB.texture;
    blurMaterial.uniforms.uDirection.value.set(0, this.texel.y);
    renderer.setRenderTarget(this.targetA);
    this.quad.render(renderer);
  }
}
