import * as THREE from 'three';
import { quality } from './quality';
import { WIND_DIR } from './wind';

/**
 * Seed fluff: dandelion and thistle down carried along the wind over the meadows on fine days, bobbing and
 * turning, lit white with a glow when it drifts between you and the sun. One draw call; positions wrap in a box
 * around the camera like the motes.
 */
const COUNT = 320;
const BOX = 44;
const f = (n: number) => n.toFixed(3);

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCam;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSky;
  uniform float uAmount;
  uniform float uWind;
  uniform float uPixelsPerMeter;
  uniform sampler2D tDepth;
  attribute vec4 aSeed;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSpin;

  void main() {
    // Carried along the wind at its own pace, with lazy loops and a slow rise and fall.
    float t = uTime;
    vec2 wind = vec2(${f(WIND_DIR.x)}, ${f(WIND_DIR.y)});
    float speed = (0.6 + aSeed.x * 0.9) * (0.4 + 0.6 * uWind);
    vec3 p = position;
    p.xz += wind * t * speed;
    p.x += sin(t * (0.3 + aSeed.y * 0.4) + aSeed.z * 6.28) * 1.2;
    p.z += cos(t * (0.25 + aSeed.z * 0.4) + aSeed.y * 6.28) * 1.2;
    p.xz = mod(p.xz - uCam.xz + ${f(BOX / 2)}, ${f(BOX)}) - ${f(BOX / 2)} + uCam.xz;
    // Height above the viewer's ground: most hang low over the grass, a few ride higher.
    float lift = 0.25 + pow(aSeed.w, 2.2) * 6.0 + sin(t * (0.4 + aSeed.x * 0.5) + aSeed.w * 30.0) * 0.35;
    p.y = uCam.y - 1.7 + lift;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;
    vec3 ndc = gl_Position.xyz / gl_Position.w;
    float hidden = 0.0;
    if (all(lessThan(abs(ndc.xy), vec2(1.0)))) {
      float scene = texture(tDepth, ndc.xy * 0.5 + 0.5).x;
      hidden = step(scene, ndc.z * 0.5 + 0.5 - 1e-5);
    }
    float edge = 1.0 - smoothstep(${f(BOX * 0.3)}, ${f(BOX * 0.5)}, length(p.xz - uCam.xz));
    float near = smoothstep(0.3, 1.2, dist);

    // White filaments: lit by the sky all round, by the sun, and glowing when backlit.
    vec3 toFluff = normalize(p - uCam);
    float forward = pow(max(dot(toFluff, uSunDir), 0.0), 5.0);
    float skyLuma = dot(uSky, vec3(0.3, 0.59, 0.11));
    vColor = mix(vec3(skyLuma), uSky, 0.25) * 0.6 + uSunColor * (0.22 + 1.8 * forward);
    vAlpha = edge * near * uAmount * (1.0 - hidden) * (0.55 + 0.45 * aSeed.y);
    vSpin = t * (0.5 + aSeed.z) + aSeed.x * 6.28;

    float size = 0.07 + 0.06 * aSeed.z;
    gl_PointSize = max(size * uPixelsPerMeter / dist, 1.5);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSpin;
  void main() {
    vec2 c = (gl_PointCoord - 0.5) * 2.0;
    float r = length(c);
    if (r > 1.0) discard;
    // A pappus: fine rays from the center ending in a soft halo, the seed a dot hanging below.
    float a = atan(c.y, c.x) + vSpin;
    float rays = pow(abs(cos(a * 6.0)), 10.0) * (1.0 - smoothstep(0.3, 1.0, r)) * 0.45;
    float puff = exp(-r * r * 3.5) * 0.5 * (1.0 - smoothstep(0.7, 1.0, r));
    float fluff = puff + rays * 0.6;
    float seed = exp(-dot(c - vec2(0.0, -0.45), c - vec2(0.0, -0.45)) * 160.0);
    float alpha = clamp(fluff + seed, 0.0, 1.0) * vAlpha;
    if (alpha < 0.004) discard;
    vec3 col = mix(vColor, vec3(0.18, 0.13, 0.08), seed);
    gl_FragColor = vec4(col, alpha);
  }
`;

export class SeedFluff {
  readonly points: THREE.Points;
  private uniforms = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uSky: { value: new THREE.Color() },
    uAmount: { value: 0 },
    uWind: { value: 1 },
    uPixelsPerMeter: { value: 600 },
    tDepth: { value: null as THREE.Texture | null },
  };
  private amount = 0;

  constructor() {
    const pos = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = Math.random() * BOX;
      pos[i * 3 + 2] = Math.random() * BOX;
      for (let k = 0; k < 4; k++) seed[i * 4 + k] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    this.points.visible = false;
  }

  setSceneDepth(depth: THREE.Texture) {
    this.uniforms.tDepth.value = depth;
  }

  /**
   * `meadow` is how open the land around the viewer is (0 deep in a forest), `fine` how fair the weather is
   * (0 in rain); both fade the fluff in and out over a few seconds.
   */
  update(time: number, dt: number, camera: THREE.Camera, sunDir: THREE.Vector3, sunColor: THREE.Color, sky: THREE.Color,
    day: number, meadow: number, fine: number, wind: number, pixelsPerMeter: number) {
    const target = THREE.MathUtils.smoothstep(day, 0.3, 0.7) * meadow * fine;
    this.amount += (target - this.amount) * Math.min(dt / 3, 1);
    const u = this.uniforms;
    u.uTime.value = time;
    u.uCam.value.copy(camera.position);
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(sunColor);
    u.uSky.value.copy(sky);
    u.uAmount.value = this.amount;
    u.uWind.value = wind;
    u.uPixelsPerMeter.value = pixelsPerMeter;
    this.points.visible = this.amount > 0.01 && quality.motes > 0;
    this.points.geometry.setDrawRange(0, Math.round(COUNT * Math.min(quality.motes * 1.5, 1)));
  }
}
