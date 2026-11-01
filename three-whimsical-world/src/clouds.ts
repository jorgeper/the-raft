import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { CLOUD_NOISE, CLOUD_HEIGHT, type SkyUniforms } from './sky';

/**
 * Raymarched volumetric cumulus at half resolution. Each view ray crosses a slab of air around the cloud layer
 * (`CLOUD_HEIGHT`); the clouds' footprint is the same 2D cover field the painted sky and the cloud shadows use, so
 * shadows on the land still line up with the clouds overhead. Inside the footprint a cumulus profile (flat base,
 * tops as tall as the cover is thick) is eaten away at the edges by 3D noise, so the clouds billow. A short march
 * toward the sun self-shadows them; color comes from the sky table's `cloudLit` / `cloudShade` stops, so they
 * blush pink and gold at a low sun like the rest of the sky.
 *
 * Output: rgb = light scattered toward the eye (premultiplied), a = transmittance. The atmosphere pass draws it over
 * the sky as `sky * a + rgb`.
 */

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const H = CLOUD_HEIGHT.toFixed(1);

function createMaterial(sky: SkyUniforms) {
  return new THREE.ShaderMaterial({
    name: 'VolumetricClouds',
    defines: { CLOUD_STEPS: 32 },
    uniforms: {
      uProjInv: { value: new THREE.Matrix4() },
      uViewInv: { value: new THREE.Matrix4() },
      /** The cover field's drift with the wind (the sky's `uCloudOffset` minus the camera's own part). */
      uDrift: { value: new THREE.Vector2() },
      // Shared with the sky, so the palette and cover stay in step with it.
      uSunDir: sky.uSunDir,
      uCloudLit: sky.uCloudLit,
      uCloudShade: sky.uCloudShade,
      uGlow: sky.uGlow,
      uHorizon: sky.uHorizon,
      uSunHorizon: sky.uSunHorizon,
      uClouds: sky.uClouds,
      uTime: sky.uTime,
    },
    vertexShader,
    fragmentShader: /* glsl */ `
      uniform mat4 uProjInv;
      uniform mat4 uViewInv;
      uniform vec2 uDrift;
      uniform vec3 uSunDir;
      uniform vec3 uCloudLit;
      uniform vec3 uCloudShade;
      uniform vec3 uGlow;
      uniform vec3 uHorizon;
      uniform vec3 uSunHorizon;
      uniform float uClouds;
      uniform float uTime;
      varying vec2 vUv;

      ${CLOUD_NOISE}

      float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float n3(vec3 x) {
        vec3 i = floor(x), f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }

      // The slab the cumulus live in: flat bases a little under the painted layer, tall tops above it.
      const float BASE = ${H} - 120.0;
      const float TOP = ${H} + 560.0;

      // Cloud density (0..1) at a world point.
      float density(vec3 p, bool detail) {
        vec2 uv = p.xz / ${H} * 0.9 + uDrift;
        float c = cloudCover(uv, uClouds);
        if (c < 0.02) return 0.0;
        float h = (p.y - BASE) / (TOP - BASE);
        // Thick cover builds tall towers, thin cover flat puffs; bases are flat, tops round.
        float top = 0.2 + 0.8 * c * c;
        float shape = smoothstep(0.0, 0.07, h) * (1.0 - smoothstep(top * 0.55, top, h));
        float d = c * shape;
        if (!detail || d <= 0.0) return d;
        // Billows: 3D noise erodes the edges (most where the cloud is thin), drifting slowly.
        vec3 q = p * 0.0035 + vec3(uTime * 0.004, -uTime * 0.002, 0.0);
        float b = n3(q) * 0.55 + n3(q * 2.9 + 3.1) * 0.3 + n3(q * 8.3 - 1.7) * 0.15;
        return clamp((d - (1.0 - d) * b * 0.55) * 1.5, 0.0, 1.0);
      }

      void main() {
        vec4 ndc = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
        vec4 view = uProjInv * ndc;
        vec3 dir = normalize((uViewInv * vec4(view.xyz / view.w, 0.0)).xyz);
        vec3 cam = uViewInv[3].xyz;
        if (dir.y < 0.015 || uClouds <= 0.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

        float t0 = (BASE - cam.y) / dir.y;
        float t1 = (TOP - cam.y) / dir.y;
        // Long grazing paths near the horizon: cap them (the far ones fade into the haze anyway).
        t1 = min(t1, t0 + 4500.0);
        const int STEPS = CLOUD_STEPS;
        float stepLen = (t1 - t0) / float(STEPS);
        float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

        float cosT = dot(dir, uSunDir);
        // Henyey-Greenstein, forward lobe plus a little back-scatter: silver linings toward the sun.
        float g = 0.55;
        float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * cosT, 1.5) * 0.25;
        // A low (or just-set) sun lights the clouds from below and the side: shorter shadowing paths, so they
        // glow in the afterglow instead of going dark. The table dims cloudLit itself as the sun goes down.
        float lowSun = 1.0 - smoothstep(0.05, 0.35, uSunDir.y);
        vec3 lightDir = normalize(vec3(uSunDir.x, max(uSunDir.y, 0.08), uSunDir.z));

        const float SIGMA = 0.007;
        float T = 1.0;
        vec3 S = vec3(0.0);
        for (int i = 0; i < STEPS; i++) {
          vec3 p = cam + dir * (t0 + (float(i) + jitter) * stepLen);
          float d = density(p, true);
          if (d <= 0.001) continue;
          // Light reaching this point: three steps toward the sun through coarse (undetailed) density.
          float od = 0.0;
          for (int k = 1; k <= 3; k++) od += density(p + lightDir * (70.0 * float(k * k)), false) * 70.0 * float(2 * k - 1);
          float sunT = exp(-SIGMA * 1.4 * od * mix(1.0, 0.6, lowSun));
          // Powder: the sunlit rims of dense clouds are a touch darker inside, which models the billows.
          float powder = 1.0 - exp(-d * 6.0);
          float h = clamp((p.y - BASE) / (TOP - BASE), 0.0, 1.0);
          vec3 ambient = uCloudShade * (0.3 + 0.8 * h);
          vec3 direct = (uCloudLit * 0.75 + uGlow * hg * 1.5) * sunT * mix(0.45, 1.0, powder);
          vec3 col = ambient + direct;
          float a = 1.0 - exp(-SIGMA * d * stepLen);
          S += T * a * col;
          T *= 1.0 - a;
          if (T < 0.02) break;
        }

        // Distant clouds sink into the horizon haze (as the painted ones do).
        vec2 flatD = normalize(dir.xz + 1e-5), flatS = normalize(uSunDir.xz + 1e-5);
        float toSun = clamp(dot(flatD, flatS) * 0.5 + 0.5, 0.0, 1.0);
        vec3 horizon = mix(uHorizon, uSunHorizon, pow(toSun, 3.0));
        float fade = smoothstep(0.015, 0.16, dir.y);
        S = mix(horizon * (1.0 - T), S, fade);
        T = mix(1.0, T, fade * 0.85 + 0.15);
        gl_FragColor = vec4(S, T);
      }
    `,
    depthTest: false,
    depthWrite: false,
  });
}

export class CloudPass extends Pass {
  private target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private quad = new FullScreenQuad();
  private material: THREE.ShaderMaterial;

  constructor(private camera: THREE.PerspectiveCamera, private sky: SkyUniforms) {
    super();
    this.needsSwap = false;
    this.material = createMaterial(sky);
    this.quad.material = this.material;
  }

  get texture() {
    return this.target.texture;
  }

  /** March steps; 0 turns the pass off (the sky then paints its flat clouds). */
  setSteps(steps: number) {
    this.enabled = steps > 0;
    if (steps > 0 && this.material.defines.CLOUD_STEPS !== steps) {
      this.material.defines.CLOUD_STEPS = steps;
      this.material.needsUpdate = true;
    }
  }

  setSize(width: number, height: number) {
    this.target.setSize(Math.max(1, Math.ceil(width / 2)), Math.max(1, Math.ceil(height / 2)));
  }

  render(renderer: THREE.WebGLRenderer) {
    const u = this.material.uniforms;
    u.uProjInv.value.copy(this.camera.projectionMatrixInverse);
    u.uViewInv.value.copy(this.camera.matrixWorld);
    // The sky's offset includes the camera's own position over the layer; the march works in world space.
    const off = this.sky.uCloudOffset.value;
    u.uDrift.value.set(off.x - (this.camera.position.x * 0.9) / CLOUD_HEIGHT, off.y - (this.camera.position.z * 0.9) / CLOUD_HEIGHT);
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer);
  }

  dispose() {
    this.target.dispose();
    this.quad.dispose();
    this.material.dispose();
  }
}
