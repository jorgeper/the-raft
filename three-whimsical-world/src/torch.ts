import * as THREE from 'three';

const flameVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Animated flame: turbulent noise scrolling upward carves a ragged teardrop, and the resulting heat maps
 * through a black-body ramp (deep red edges, orange body, yellow-white core). Output is HDR and additive.
 */
const flameFragment = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uSeed;
  uniform float uLean;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    float t = uTime + uSeed * 10.0;
    // Turbulence rises faster than the flame body, and grows toward the top.
    float n1 = fbm(vec2(uv.x * 3.0 + uSeed, uv.y * 2.2 - t * 2.6));
    float n2 = fbm(vec2(uv.x * 7.0 - uSeed, uv.y * 5.5 - t * 4.8));
    float sway = (n1 - 0.5) * 0.45 * uv.y + (n2 - 0.5) * 0.15 * uv.y + uLean * uv.y * uv.y;
    float x = uv.x - 0.5 - sway;

    // Teardrop: rounded base, widest a fifth of the way up, tapering into licking tongues.
    float width = 0.34 * pow(1.0 - uv.y, 0.75) * smoothstep(0.0, 0.18, uv.y + 0.04);
    float body = 1.0 - smoothstep(width * 0.55, width, abs(x));
    float tongues = smoothstep(0.25, 0.75, n2 + (1.0 - uv.y) * 0.6);
    float heat = body * mix(1.0, tongues, smoothstep(0.25, 0.85, uv.y));
    heat *= 0.55 + 0.75 * n1;
    // Hottest low in the middle, just above the fuel.
    heat *= 1.0 + 0.9 * (1.0 - smoothstep(0.0, 0.35, abs(uv.y - 0.22))) * (1.0 - smoothstep(0.0, 0.18, abs(x)));
    // Never reach the quad's edges, so no hard lines show.
    heat *= (1.0 - smoothstep(0.8, 0.98, uv.y)) * (1.0 - smoothstep(0.38, 0.49, abs(uv.x - 0.5)));

    vec3 color = vec3(0.35, 0.02, 0.0);
    color = mix(color, vec3(1.0, 0.22, 0.02), smoothstep(0.08, 0.38, heat));
    color = mix(color, vec3(1.0, 0.55, 0.1), smoothstep(0.38, 0.7, heat));
    color = mix(color, vec3(1.0, 0.86, 0.45), smoothstep(0.7, 1.0, heat));
    color = mix(color, vec3(1.0, 0.98, 0.9), smoothstep(1.0, 1.35, heat));
    float alpha = smoothstep(0.04, 0.3, heat);
    gl_FragColor = vec4(color * alpha * uIntensity * (0.5 + 0.6 * heat), 1.0);
  }
`;

/** Soft round sprite for embers, smoke and the glow halo. */
function createSoftTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

interface ParticleSpec {
  rate: number;
  life: [number, number];
  speed: [number, number];
  spread: number;
  size: [number, number];
  grow: number;
  color: THREE.Color;
  additive: boolean;
  opacity: number;
  drag: number;
  turbulence: number;
}

/** World-space particles (so they trail behind as you walk), simulated on the CPU. */
class Particles {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private alpha: Float32Array;
  private size: Float32Array;
  private next = 0;
  private carry = 0;

  constructor(private count: number, private spec: ParticleSpec, texture: THREE.Texture) {
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count).fill(1);
    this.alpha = new Float32Array(count);
    this.size = new Float32Array(count);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture }, uColor: { value: spec.color }, uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute float aSize;
        uniform float uScale;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // aSize is in meters; uScale converts to pixels at 1 m distance.
          gl_PointSize = aSize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          float a = texture2D(uMap, gl_PointCoord).a * vAlpha;
          ${spec.additive ? 'gl_FragColor = vec4(uColor * a, 1.0);' : 'gl_FragColor = vec4(uColor, a);'}
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: spec.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
  }

  update(origin: THREE.Vector3, dt: number, emitting: boolean, time: number, pixelsPerMeter: number) {
    const s = this.spec;
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value = pixelsPerMeter;
    if (emitting) {
      this.carry += s.rate * dt;
      while (this.carry >= 1) {
        this.carry -= 1;
        const i = this.next;
        this.next = (this.next + 1) % this.count;
        this.pos[i * 3] = origin.x + (Math.random() - 0.5) * s.spread;
        this.pos[i * 3 + 1] = origin.y + Math.random() * s.spread;
        this.pos[i * 3 + 2] = origin.z + (Math.random() - 0.5) * s.spread;
        const speed = s.speed[0] + Math.random() * (s.speed[1] - s.speed[0]);
        this.vel[i * 3] = (Math.random() - 0.5) * speed * 0.6;
        this.vel[i * 3 + 1] = speed;
        this.vel[i * 3 + 2] = (Math.random() - 0.5) * speed * 0.6;
        this.maxLife[i] = s.life[0] + Math.random() * (s.life[1] - s.life[0]);
        this.life[i] = this.maxLife[i];
        this.size[i] = s.size[0] + Math.random() * (s.size[1] - s.size[0]);
      }
    }
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const k = i * 3;
      // Swirling updraft: a little curl so embers zig-zag instead of rising in straight lines.
      this.vel[k] += Math.sin(time * 3 + i * 1.7) * s.turbulence * dt;
      this.vel[k + 2] += Math.cos(time * 2.6 + i * 2.3) * s.turbulence * dt;
      const drag = Math.exp(-s.drag * dt);
      this.vel[k] *= drag;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      const age = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = Math.max(this.size[i] * (1 + s.grow * dt), 0.002);
      // Fade in quickly, out slowly; embers also twinkle as they cool.
      this.alpha[i] = s.opacity * Math.min(age * 8, 1) * (1 - age) * (s.additive ? 0.6 + 0.4 * Math.sin(time * 25 + i) : 1);
    }
    const geo = this.points.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  }
}

/**
 * A torch held in the right hand: a charred stick with an animated flame, rising embers and smoke, a
 * shadow-casting spotlight aimed where you look, and a warm omnidirectional glow. Attach `object` to the
 * camera and add `world` to the scene.
 */
export class Torch {
  readonly object = new THREE.Group();
  /** Particles and lights that live in world space. */
  readonly world = new THREE.Group();
  /** Shadow-casting light, aimed along the view. */
  readonly spot = new THREE.SpotLight('#ff9a4a', 0, 40, 1.15, 0.9, 2);
  /** Fill so the ground around you and behind you is lit too (no shadows; cheap). */
  readonly glow = new THREE.PointLight('#ff8a3a', 0, 22, 2);
  /** World-space flame position and color×intensity for the volumetric glow in the haze pass. */
  readonly flameWorld = new THREE.Vector3();
  readonly flameColor = new THREE.Color();
  on = false;
  /** Overall brightness multiplier (configurable). */
  brightness = 1;
  embersOn = true;
  smokeOn = true;

  private stick = new THREE.Group();
  private flame = new THREE.Group();
  private flameMaterials: THREE.ShaderMaterial[] = [];
  private head: THREE.MeshBasicMaterial;
  private embers: Particles;
  private smoke: Particles;
  private level = 0;
  private flicker = 1;
  private flickerTarget = 1;
  private flickerTimer = 0;
  private lean = 0;
  private lastPos = new THREE.Vector3();
  private velocity = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private forward = new THREE.Vector3();
  private quat = new THREE.Quaternion();

  constructor() {
    // The stick is unlit: its own lights sit centimetres away and would blow it out. Instead it's shaded by hand,
    // dim wood with the charred head glowing faintly under the flame.
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.55, 8), new THREE.MeshBasicMaterial({ color: '#2e1d12' }));
    this.head = new THREE.MeshBasicMaterial({ color: '#1a0c06' });
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.028, 0.13, 10), this.head);
    wrap.position.y = 0.3;
    this.stick.add(handle, wrap);

    // Two flame layers with different noise seeds: a wide soft outer flame and a tight bright inner one.
    const flameGeo = new THREE.PlaneGeometry(1, 1);
    flameGeo.translate(0, 0.5, 0);
    for (const [w, h, intensity, seed] of [
      [0.34, 0.46, 0.55, 0.3],
      [0.2, 0.26, 0.9, 1.7],
    ]) {
      const material = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uIntensity: { value: intensity }, uSeed: { value: seed }, uLean: { value: 0 } },
        vertexShader: flameVertex,
        fragmentShader: flameFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(flameGeo, material);
      mesh.scale.set(w, h, 1);
      mesh.position.y = 0.0;
      this.flameMaterials.push(material);
      this.flame.add(mesh);
    }
    // Soft halo so the flame lights the air around it.
    const soft = createSoftTexture();
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: soft,
        color: new THREE.Color('#ff7a20').multiplyScalar(0.22),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    halo.scale.setScalar(0.55);
    halo.position.y = 0.2;
    this.flame.add(halo);
    this.flame.position.y = 0.37;
    this.stick.add(this.flame);

    this.stick.rotation.set(-0.35, 0, -0.25);
    this.stick.position.set(0.42, -0.55, -0.85);
    this.object.add(this.stick);
    this.object.visible = false;

    this.embers = new Particles(
      90,
      {
        rate: 22, life: [0.6, 1.8], speed: [0.6, 1.6], spread: 0.06, size: [0.012, 0.03], grow: -0.6,
        color: new THREE.Color(5, 1.8, 0.4), additive: true, opacity: 1, drag: 1.5, turbulence: 3,
      },
      soft,
    );
    this.smoke = new Particles(
      60,
      {
        rate: 14, life: [1.5, 3], speed: [0.4, 0.8], spread: 0.05, size: [0.08, 0.14], grow: 0.9,
        color: new THREE.Color(0.06, 0.055, 0.05), additive: false, opacity: 0.35, drag: 0.8, turbulence: 0.8,
      },
      soft,
    );
    this.world.add(this.smoke.points, this.embers.points);

    this.spot.castShadow = true;
    this.spot.shadow.mapSize.set(1024, 1024);
    this.spot.shadow.bias = -0.0008;
    this.spot.shadow.normalBias = 0.05;
    this.spot.shadow.camera.near = 0.3;
    this.spot.shadow.camera.far = 40;
    this.spot.visible = false;
    this.glow.visible = false;
    this.world.add(this.spot, this.spot.target, this.glow);
  }

  toggle() {
    this.on = !this.on;
  }

  /** Call each frame after the camera moves. `pixelsPerMeter` is the viewport height in pixels over 2·tan(fov/2). */
  update(camera: THREE.Camera, time: number, dt: number, pixelsPerMeter: number) {
    // Ease in/out so lighting it feels like it catches.
    this.level += ((this.on ? 1 : 0) - this.level) * Math.min(dt * 5, 1);
    const visible = this.level > 0.01;
    this.object.visible = this.spot.visible = this.glow.visible = visible;

    this.flame.getWorldPosition(this.flameWorld);
    this.embers.update(this.tmp.copy(this.flameWorld).setY(this.flameWorld.y + 0.12), dt, this.on && this.embersOn, time, pixelsPerMeter);
    this.smoke.update(this.tmp.copy(this.flameWorld).setY(this.flameWorld.y + 0.3), dt, this.on && this.smokeOn, time, pixelsPerMeter);
    if (!visible) {
      this.flameColor.setRGB(0, 0, 0);
      this.lastPos.copy(this.flameWorld);
      return;
    }

    // Irregular flicker: drift toward a new random level every few frames, plus a fast shimmer.
    this.flickerTimer -= dt;
    if (this.flickerTimer <= 0) {
      this.flickerTimer = 0.05 + Math.random() * 0.12;
      this.flickerTarget = 0.72 + Math.random() * 0.4;
    }
    this.flicker += (this.flickerTarget - this.flicker) * Math.min(dt * 14, 1);
    const shimmer = this.flicker * (0.96 + 0.04 * Math.sin(time * 47));

    // Flames always face the camera: undo the stick's tilt.
    this.flame.quaternion.copy(this.quat.copy(this.stick.quaternion).invert());
    // Moving drags the flame backward; sideways motion shows as a lean.
    if (dt > 0) this.velocity.subVectors(this.flameWorld, this.lastPos).divideScalar(dt);
    this.lastPos.copy(this.flameWorld);
    const right = this.tmp.set(1, 0, 0).applyQuaternion(camera.quaternion);
    const targetLean = -THREE.MathUtils.clamp(this.velocity.dot(right) * 0.08, -0.4, 0.4);
    this.lean += (targetLean - this.lean) * Math.min(dt * 6, 1);
    for (const m of this.flameMaterials) {
      m.uniforms.uTime.value = time;
      m.uniforms.uLean.value = this.lean;
    }
    this.flame.scale.setScalar(this.level * (0.92 + 0.1 * this.flicker));
    // Embers in the wrapping pulse with the flame.
    this.head.color.setRGB(0.04 + 0.1 * shimmer * this.level, 0.015 + 0.02 * shimmer * this.level, 0.005);

    // Lights wobble a couple of centimetres so shadows dance with the flame.
    const jitter = this.tmp.set(Math.sin(time * 13.7), Math.sin(time * 9.1) * 0.5, Math.cos(time * 11.3)).multiplyScalar(0.02);
    this.spot.position.copy(this.flameWorld).add(jitter);
    this.glow.position.copy(this.flameWorld).add(jitter);
    camera.getWorldDirection(this.forward);
    this.forward.y -= 0.25;
    this.spot.target.position.copy(this.flameWorld).addScaledVector(this.forward.normalize(), 10);
    this.spot.target.updateMatrixWorld();

    const k = shimmer * this.level * this.brightness;
    this.spot.intensity = 32 * k;
    this.glow.intensity = 7 * k;
    this.flameColor.set('#ff8a3a').multiplyScalar(k);
  }
}
