import * as THREE from 'three';

/**
 * Floating motes around the viewer: pollen and dust that catch the sun by day (brightest when you look toward
 * it, like the sparkles in Valheim's sunbeams) and fireflies that blink low over the ground at dusk and night.
 * One draw call; positions wrap in a box that follows the camera, so the field is endless and costs nothing
 * to move.
 */
const COUNT = 2400;
const BOX = 36; // meters, the wrapped volume around the camera
/** A number as a GLSL float literal. */
const f = (n: number) => n.toFixed(2);

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uCam;
  uniform vec3 uSunDir;
  uniform float uDay;
  uniform float uAmount;
  uniform float uPixelsPerMeter;
  uniform sampler2D tDepth;
  uniform float uHasDepth;
  attribute vec4 aSeed;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    // Each mote drifts on its own slow loop plus a shared breeze, wrapped into the box around the camera.
    vec3 drift = vec3(
      sin(uTime * 0.21 * (0.6 + aSeed.x) + aSeed.y * 6.28) * 1.6 + uTime * 0.35,
      sin(uTime * 0.17 * (0.6 + aSeed.z) + aSeed.x * 6.28) * 0.8 + uTime * 0.05,
      cos(uTime * 0.19 * (0.6 + aSeed.y) + aSeed.z * 6.28) * 1.6 + uTime * 0.12
    );
    vec3 p = position + drift;
    p = mod(p - uCam + ${f(BOX / 2)}, ${f(BOX)}) - ${f(BOX / 2)} + uCam;
    float fireflies = 1.0 - uDay;
    // Fireflies hover in the lowest couple of meters; daytime motes fill the air around you.
    p.y = mix(p.y, uCam.y - 1.4 + fract(aSeed.w * 7.3) * 2.2 + sin(uTime * 0.7 + aSeed.x * 20.0) * 0.25, fireflies);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;
    // Drawn after the haze without a depth buffer: hide motes behind trunks, leaves and hills by hand.
    vec3 ndc = gl_Position.xyz / gl_Position.w;
    float hidden = 0.0;
    if (uHasDepth > 0.5 && all(lessThan(abs(ndc.xy), vec2(1.0)))) {
      float scene = texture(tDepth, ndc.xy * 0.5 + 0.5).x;
      hidden = step(scene, ndc.z * 0.5 + 0.5 - 1e-5);
    }
    // Fade in from the box edge and out right at the lens.
    float edge = 1.0 - smoothstep(${f(BOX * 0.32)}, ${f(BOX * 0.5)}, length(p - uCam));
    float near = smoothstep(0.4, 1.5, dist);

    // Daytime: forward scattering, so motes between you and the sun sparkle.
    vec3 toMote = normalize(p - uCam);
    float forward = pow(max(dot(toMote, uSunDir), 0.0), 6.0);
    float twinkle = 0.55 + 0.45 * sin(uTime * (2.0 + aSeed.y * 5.0) + aSeed.w * 40.0);
    float dayGlow = (0.35 + 6.0 * forward) * twinkle;
    // Night: fireflies blink on and off.
    float blink = smoothstep(0.55, 0.95, sin(uTime * (0.8 + aSeed.z) + aSeed.x * 31.0));
    vColor = mix(vec3(1.0, 0.86, 0.55) * dayGlow, vec3(0.75, 1.0, 0.35) * blink * 2.4, fireflies);
    // Fewer fireflies than dust motes.
    float keep = mix(1.0, step(aSeed.w, 0.35), fireflies);
    vAlpha = edge * near * keep * uAmount * (1.0 - hidden);

    float size = mix(0.03 + 0.04 * aSeed.x, 0.05, fireflies);
    gl_PointSize = max(size * uPixelsPerMeter / dist, 1.5);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    float soft = exp(-d * d * 4.0);
    if (soft * vAlpha < 0.003) discard;
    gl_FragColor = vec4(vColor * soft * vAlpha, 1.0);
  }
`;

export class Motes {
  readonly points: THREE.Points;
  private uniforms = {
    uTime: { value: 0 },
    uCam: { value: new THREE.Vector3() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uDay: { value: 1 },
    uAmount: { value: 0 },
    uPixelsPerMeter: { value: 600 },
    tDepth: { value: null as THREE.Texture | null },
    uHasDepth: { value: 0 },
  };

  constructor() {
    const pos = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT * 4);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3] = Math.random() * BOX;
      pos[i * 3 + 1] = Math.random() * BOX * 0.5;
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
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  /** The scene depth buffer to hide behind (the motes draw after the haze, outside the scene's depth test). */
  setSceneDepth(depth: THREE.Texture) {
    this.uniforms.tDepth.value = depth;
    this.uniforms.uHasDepth.value = 1;
  }

  /** `amount` scales visibility (0 hides them); `day` is 1 in daylight and 0 at night. */
  update(time: number, camera: THREE.Camera, sunDir: THREE.Vector3, day: number, amount: number, pixelsPerMeter: number) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uCam.value.copy(camera.position);
    u.uSunDir.value.copy(sunDir);
    u.uDay.value = day;
    u.uAmount.value = amount;
    u.uPixelsPerMeter.value = pixelsPerMeter;
    this.points.visible = amount > 0.01;
  }
}
