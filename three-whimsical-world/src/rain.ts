import * as THREE from 'three';
import { WIND_DIR } from './wind';

/**
 * Falling rain: thin streaks in a box that follows the camera (positions wrap, so the shower is endless and costs
 * nothing to move). Drawn after the haze and the TAA (thin fast streaks would ghost in the history), hidden behind
 * geometry by testing the scene depth by hand like the motes. Lit by the sky's color, a little brighter toward the
 * sun, so it reads grey-silver against dark trees and darker against a bright sky.
 */
const COUNT = 12000;
const BOX = 30; // meters across
const HEIGHT = 22;
const f = (n: number) => n.toFixed(2);

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCam;
  uniform float uAmount;
  uniform sampler2D tDepth;
  uniform float uHasDepth;
  uniform vec3 uSunDir;
  attribute vec4 aSeed;
  /** 0 for a streak's head, 1 for its tail. */
  attribute float aEnd;
  varying float vAlpha;
  varying float vSun;

  void main() {
    float speed = 8.0 + 3.0 * aSeed.w;
    vec3 vel = vec3(${f(WIND_DIR.x * 1.6)}, -speed, ${f(WIND_DIR.y * 1.6)});
    vec3 p = position + vel * uTime;
    p.xz = mod(p.xz - uCam.xz + ${f(BOX / 2)}, ${f(BOX)}) - ${f(BOX / 2)} + uCam.xz;
    p.y = mod(p.y - uCam.y + ${f(HEIGHT * 0.35)}, ${f(HEIGHT)}) - ${f(HEIGHT * 0.35)} + uCam.y;
    // The tail trails the head by what the drop falls in a short exposure.
    p -= vel * aEnd * (0.03 + 0.015 * aSeed.z);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vec3 ndc = gl_Position.xyz / gl_Position.w;
    float hidden = 0.0;
    if (uHasDepth > 0.5 && all(lessThan(abs(ndc.xy), vec2(1.0))) && gl_Position.w > 0.0) {
      float scene = texture(tDepth, ndc.xy * 0.5 + 0.5).x;
      hidden = step(scene, ndc.z * 0.5 + 0.5 - 1e-5);
    }
    float dist = length(p - uCam);
    // Only some of the drops in a light shower; all of them in a downpour.
    float keep = step(aSeed.x, uAmount);
    // The depth tested above has no water in it: end drops at the sea surface instead.
    keep *= step(0.0, p.y);
    vAlpha = keep * (1.0 - hidden) * smoothstep(0.6, 2.0, dist) * (1.0 - smoothstep(${f(BOX * 0.3)}, ${f(BOX * 0.5)}, dist));
    vSun = pow(max(dot(normalize(p - uCam), uSunDir), 0.0), 4.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uSunColor;
  varying float vAlpha;
  varying float vSun;
  void main() {
    if (vAlpha < 0.01) discard;
    gl_FragColor = vec4(uColor * 0.7 + uSunColor * vSun * 0.6, vAlpha * 0.24);
  }
`;

export class Rain {
  readonly lines: THREE.LineSegments;
  private uniforms = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uAmount: { value: 0 },
    tDepth: { value: null as THREE.Texture | null },
    uHasDepth: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uColor: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() },
  };

  constructor() {
    const pos = new Float32Array(COUNT * 2 * 3);
    const seed = new Float32Array(COUNT * 2 * 4);
    const end = new Float32Array(COUNT * 2);
    for (let i = 0; i < COUNT; i++) {
      const x = Math.random() * BOX, y = Math.random() * HEIGHT, z = Math.random() * BOX;
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let e = 0; e < 2; e++) {
        const v = i * 2 + e;
        pos.set([x, y, z], v * 3);
        seed.set(s, v * 4);
        end[v] = e;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.lines = new THREE.LineSegments(geo, mat);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
  }

  setSceneDepth(depth: THREE.Texture) {
    this.uniforms.tDepth.value = depth;
    this.uniforms.uHasDepth.value = 1;
  }

  /** `amount` 0..1 is how hard it rains (the share of drops shown); `density` scales the drop count (performance). */
  update(time: number, camera: THREE.Camera, amount: number, density: number, skyColor: THREE.Color, sunDir: THREE.Vector3, sunColor: THREE.Color) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uCam.value.copy(camera.position);
    u.uAmount.value = amount;
    u.uSunDir.value.copy(sunDir);
    u.uColor.value.copy(skyColor);
    u.uSunColor.value.copy(sunColor);
    this.lines.visible = amount > 0.01 && density > 0;
    this.lines.geometry.setDrawRange(0, Math.round(COUNT * Math.min(density, 1)) * 2);
  }
}
