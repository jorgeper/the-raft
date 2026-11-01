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

const SPLASHES = 700;
const SPLASH_LIFE = 0.32; // seconds

const splashVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelsPerMeter;
  uniform sampler2D tDepth;
  uniform float uNear;
  uniform float uFar;
  uniform vec3 uCam;
  /** Birth time of the splash (seconds), and a random 0..1. */
  attribute vec2 aBirth;
  varying float vAge;
  varying float vFlat;
  varying float vSeed;
  float viewZ(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }
  void main() {
    vAge = (uTime - aBirth.x) / ${SPLASH_LIFE.toFixed(2)};
    vSeed = aBirth.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;
    // Seen from above a ring is round; from eye height it is a flat ellipse.
    vFlat = clamp(abs(normalize(position - uCam).y) * 1.6, 0.18, 1.0);
    vec3 ndc = gl_Position.xyz / gl_Position.w;
    float hidden = 0.0;
    if (all(lessThan(abs(ndc.xy), vec2(1.0))) && gl_Position.w > 0.0) {
      float scene = viewZ(texture(tDepth, ndc.xy * 0.5 + 0.5).x);
      // Sitting on the ground, so only something clearly in front (a blade, a stone) hides it.
      hidden = step(scene, dist - 0.35);
    }
    if (vAge < 0.0 || vAge > 1.0 || hidden > 0.5) vAge = -1.0;
    gl_PointSize = max(0.2 * uPixelsPerMeter / dist, 2.0);
  }
`;
const splashFragment = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAmount;
  varying float vAge;
  varying float vFlat;
  varying float vSeed;
  void main() {
    if (vAge < 0.0) discard;
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    p.y = -p.y;
    // The ring spreading on the ground (an ellipse foreshortened by the view), from the lower part of the sprite.
    vec2 r = vec2(p.x, (p.y + 0.55) / vFlat);
    float radius = 0.15 + 0.75 * sqrt(vAge);
    float ring = 1.0 - smoothstep(0.02, 0.14, abs(length(r) - radius));
    // The crown: a few droplets thrown up and falling back in the first half of its life.
    float crown = 0.0;
    for (int i = 0; i < 4; i++) {
      float a = (float(i) + vSeed) * 1.5708 + 0.4;
      float h = 4.0 * vAge * (1.0 - vAge) * (0.7 + 0.3 * fract(vSeed * 7.0 + float(i) * 0.37));
      vec2 dp = vec2(cos(a) * 0.55 * vAge, -0.55 + h * 1.1);
      crown += (1.0 - smoothstep(0.0, 0.09, length(p - dp))) * 0.6;
    }
    float a = (ring * 0.35 * (1.0 - vAge) + min(crown, 1.0) * (1.0 - vAge * vAge)) * (1.0 - vAge) * uAmount;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a * 0.3);
  }
`;

/**
 * Splashes where raindrops hit the ground: a small crown of droplets and a ring spreading out, for a third of a
 * second, around and ahead of the viewer. Placed on the CPU at the terrain height (on land only: the water has its
 * own rings) and hidden behind grass and stones by the scene depth.
 */
export class Splashes {
  readonly points: THREE.Points;
  private pos = new Float32Array(SPLASHES * 3);
  private birth = new Float32Array(SPLASHES * 2);
  private uniforms = {
    uTime: { value: 0 },
    uPixelsPerMeter: { value: 600 },
    tDepth: { value: null as THREE.Texture | null },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uCam: { value: new THREE.Vector3() },
    uColor: { value: new THREE.Color() },
    uAmount: { value: 0 },
  };
  private dir = new THREE.Vector3();

  constructor(private height: (x: number, z: number) => number) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aBirth', new THREE.BufferAttribute(this.birth, 2));
    for (let i = 0; i < SPLASHES; i++) this.birth[i * 2] = -10;
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: splashVertex,
        fragmentShader: splashFragment,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  setSceneDepth(depth: THREE.Texture) {
    this.uniforms.tDepth.value = depth;
  }

  setHeight(height: (x: number, z: number) => number) {
    this.height = height;
  }

  update(time: number, camera: THREE.PerspectiveCamera, amount: number, density: number, color: THREE.Color, pixelsPerMeter: number) {
    const u = this.uniforms;
    this.points.visible = amount > 0.05 && density > 0;
    if (!this.points.visible) return;
    u.uTime.value = time;
    u.uAmount.value = Math.min(amount * 1.4, 1);
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uCam.value.copy(camera.position);
    u.uColor.value.copy(color);
    u.uPixelsPerMeter.value = pixelsPerMeter;
    camera.getWorldDirection(this.dir);
    const fx = this.dir.x, fz = this.dir.z, fl = Math.hypot(fx, fz) || 1;
    const count = Math.round(SPLASHES * Math.min(density, 1) * amount);
    let changed = false;
    for (let i = 0; i < count; i++) {
      if (time - this.birth[i * 2] < SPLASH_LIFE * (1 + this.birth[i * 2 + 1])) continue;
      // Respawn: mostly in front, from right at your feet out to ~14 m (denser near, like the drops themselves).
      const r = 0.8 + Math.pow(Math.random(), 0.7) * 13;
      const ang = Math.atan2(fz / fl, fx / fl) + (Math.random() - 0.5) * 2.2;
      const x = camera.position.x + Math.cos(ang) * r, z = camera.position.z + Math.sin(ang) * r;
      const h = this.height(x, z);
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = h < 0.05 ? -1e4 : h + 0.03;
      this.pos[i * 3 + 2] = z;
      this.birth[i * 2] = time + Math.random() * 0.1;
      this.birth[i * 2 + 1] = Math.random();
      changed = true;
    }
    for (let i = count; i < SPLASHES; i++) this.birth[i * 2] = -10;
    if (changed) {
      (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (this.points.geometry.attributes.aBirth as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}

const FLAKES = 9000;
const SNOW_BOX = 36;
const SNOW_HEIGHT = 20;

const snowVertex = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCam;
  uniform float uAmount;
  uniform sampler2D tDepth;
  uniform float uPixelsPerMeter;
  attribute vec4 aSeed;
  varying float vAlpha;
  void main() {
    // Slow and fluttering: each flake falls at its own pace, drifts with the wind and swings in small loops.
    float speed = 0.8 + 0.7 * aSeed.w;
    float t = uTime + aSeed.z * 50.0;
    vec3 p = position + vec3(${f(WIND_DIR.x * 0.9)}, -speed, ${f(WIND_DIR.y * 0.9)}) * uTime;
    p.x += sin(t * (0.9 + aSeed.y) + aSeed.x * 6.28) * 0.35;
    p.z += cos(t * (0.7 + aSeed.x) + aSeed.y * 6.28) * 0.35;
    p.xz = mod(p.xz - uCam.xz + ${f(SNOW_BOX / 2)}, ${f(SNOW_BOX)}) - ${f(SNOW_BOX / 2)} + uCam.xz;
    p.y = mod(p.y - uCam.y + ${f(SNOW_HEIGHT * 0.35)}, ${f(SNOW_HEIGHT)}) - ${f(SNOW_HEIGHT * 0.35)} + uCam.y;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vec3 ndc = gl_Position.xyz / gl_Position.w;
    float hidden = 0.0;
    if (all(lessThan(abs(ndc.xy), vec2(1.0))) && gl_Position.w > 0.0) {
      float scene = texture(tDepth, ndc.xy * 0.5 + 0.5).x;
      hidden = step(scene, ndc.z * 0.5 + 0.5 - 1e-5);
    }
    float dist = -mv.z;
    float keep = step(aSeed.x, uAmount) * step(0.0, p.y);
    vAlpha = keep * (1.0 - hidden) * smoothstep(0.3, 1.2, dist) * (1.0 - smoothstep(${f(SNOW_BOX * 0.3)}, ${f(SNOW_BOX * 0.5)}, dist));
    // A flake is ~1.5 cm, drawn at least a soft pixel or two across.
    gl_PointSize = clamp((0.012 + 0.012 * aSeed.y) * uPixelsPerMeter / max(dist, 0.1), 1.5, 14.0);
  }
`;
const snowFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.01) discard;
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = (1.0 - smoothstep(0.35, 1.0, d)) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a * 0.85);
  }
`;

/**
 * Falling snow: soft flakes in a box that follows the camera like the rain, drifting down slowly in little loops.
 * Lit a touch brighter than the sky's horizon color, so they read white against trees and grey against cloud.
 */
export class Snow {
  readonly points: THREE.Points;
  private uniforms = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uAmount: { value: 0 },
    tDepth: { value: null as THREE.Texture | null },
    uPixelsPerMeter: { value: 600 },
    uColor: { value: new THREE.Color() },
  };

  constructor() {
    const pos = new Float32Array(FLAKES * 3);
    const seed = new Float32Array(FLAKES * 4);
    for (let i = 0; i < FLAKES; i++) {
      pos.set([Math.random() * SNOW_BOX, Math.random() * SNOW_HEIGHT, Math.random() * SNOW_BOX], i * 3);
      seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: snowVertex,
        fragmentShader: snowFragment,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  setSceneDepth(depth: THREE.Texture) {
    this.uniforms.tDepth.value = depth;
  }

  update(time: number, camera: THREE.Camera, amount: number, density: number, skyColor: THREE.Color, pixelsPerMeter: number) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uCam.value.copy(camera.position);
    u.uAmount.value = amount;
    u.uPixelsPerMeter.value = pixelsPerMeter;
    // Brighter than the sky behind, never past white.
    u.uColor.value.copy(skyColor).multiplyScalar(1.6).lerp(new THREE.Color(1, 1, 1), 0.3);
    this.points.visible = amount > 0.01 && density > 0;
    this.points.geometry.setDrawRange(0, Math.round(FLAKES * Math.min(density, 1)));
  }
}
