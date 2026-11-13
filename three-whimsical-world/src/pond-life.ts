import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, type Pond, type WorldFns } from './worldgen';
import { addRipple } from './water';

/**
 * Pond life: water lilies (pads and flowers) floating in rafts, frogs sitting on the pads and the shore that croak,
 * hop between them and dive when you come close, and fish drifting under the surface. One instanced draw each;
 * the CPU moves the frogs and fish of the ponds near the viewer.
 */

/** Colors a geometry per vertex (from position and normal) and tags it with a per-vertex weight for the shader. */
function part(geo: THREE.BufferGeometry, color: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color, flag: (p: THREE.Vector3) => number, m: THREE.Matrix4) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  g.applyMatrix4(m);
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3), flags = new Float32Array(pos.count);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    color(p, n).toArray(colors, i * 3);
    flags[i] = flag(p);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aFlag', new THREE.BufferAttribute(flags, 1));
  return g;
}

const mat4 = (pos: [number, number, number], scale: [number, number, number], rot: [number, number, number] = [0, 0, 0]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
const flat = (c: string) => {
  const color = new THREE.Color(c);
  return () => color;
};
const none = () => 0;

/** A lily pad: a disc with a notch, its rim turned up a little; lighter and yellower toward the middle. */
function createPadGeometry() {
  const geo = new THREE.CircleGeometry(1, 28, 0.22, Math.PI * 2 - 0.44);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    pos.setY(i, 0.04 * Math.pow(r, 6));
  }
  geo.computeVertexNormals();
  const mid = new THREE.Color('#7a9a30'), rim = new THREE.Color('#2f5a18'), c = new THREE.Color();
  return part(geo, (p) => c.copy(mid).lerp(rim, Math.min(Math.hypot(p.x, p.z), 1) ** 1.5), none, new THREE.Matrix4());
}

/** A water lily: two rings of pointed petals around a yellow heart; petals pale at the base, tinted at the tips. */
function createFlowerGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.Color('#ffffff'), tip = new THREE.Color('#ffd6e4'), c = new THREE.Color();
  const ring = (n: number, length: number, width: number, lift: number, turn: number) => {
    for (let i = 0; i < n; i++) {
      // A diamond in the xz plane pointing +z, tilted up by `lift`, then turned around the heart.
      const g = new THREE.BufferGeometry();
      const v = [0, 0, 0, width / 2, 0, length * 0.45, 0, 0, length, -width / 2, 0, length * 0.45];
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.rotateX(-lift);
      g.rotateY(turn + (i / n) * Math.PI * 2);
      g.translate(0, 0.008, 0);
      g.computeVertexNormals();
      parts.push(part(g, (p) => c.copy(base).lerp(tip, Math.min(Math.hypot(p.x, p.z) / length, 1) ** 2), none, new THREE.Matrix4()));
    }
  };
  ring(9, 0.11, 0.042, 0.35, 0);
  ring(8, 0.085, 0.036, 0.85, 0.3);
  ring(6, 0.06, 0.03, 1.2, 0.1);
  parts.push(part(new THREE.CylinderGeometry(0.018, 0.014, 0.03, 8), flat('#f2c21a'), none, mat4([0, 0.025, 0], [1, 1, 1])));
  return mergeGeometries(parts)!;
}

/** A frog about 10 cm long facing +z; aFlag marks the throat sac. Pale belly, darker back (the instance color). */
function createFrogGeometry() {
  const belly = new THREE.Color('#e4dca0'), back = new THREE.Color('#ffffff'), c = new THREE.Color();
  const skin = (p: THREE.Vector3, n: THREE.Vector3) => c.copy(belly).lerp(back, THREE.MathUtils.smoothstep(n.y, -0.35, 0.25));
  const sphere = () => new THREE.SphereGeometry(1, 12, 8);
  const parts = [
    part(sphere(), skin, none, mat4([0, 0.032, -0.008], [0.042, 0.03, 0.056], [-0.3, 0, 0])),
    part(sphere(), skin, none, mat4([0, 0.043, 0.038], [0.036, 0.022, 0.032], [0.15, 0, 0])),
    part(sphere(), flat('#efe6b0'), () => 1, mat4([0, 0.03, 0.045], [0.024, 0.011, 0.02])),
  ];
  for (const k of [-1, 1]) {
    // Bulging golden eyes with a dark band.
    parts.push(part(sphere(), (p) => c.set(p.y > 0.064 ? '#2a2210' : '#b08a2a'), none, mat4([0.021 * k, 0.058, 0.045], [0.012, 0.012, 0.012])));
    // Folded back legs: thigh and foot, splayed out.
    parts.push(part(sphere(), skin, none, mat4([0.037 * k, 0.022, -0.026], [0.016, 0.014, 0.036], [0, 0.55 * k, 0])));
    parts.push(part(sphere(), skin, none, mat4([0.05 * k, 0.005, 0.0], [0.012, 0.005, 0.03], [0, -0.35 * k, 0])));
    // Front legs.
    parts.push(part(new THREE.CylinderGeometry(0.0055, 0.0045, 0.032, 6), skin, none, mat4([0.026 * k, 0.016, 0.046], [1, 1, 1], [0.3, 0, -0.35 * k])));
  }
  return mergeGeometries(parts)!;
}

/** A fish about 35 cm long facing +z: dark back, pale belly; aFlag grows toward the tail, which the shader wags. */
function createFishGeometry() {
  const belly = new THREE.Color('#e8e0c8'), back = new THREE.Color('#ffffff'), c = new THREE.Color();
  const skin = (p: THREE.Vector3, n: THREE.Vector3) => c.copy(belly).lerp(back, THREE.MathUtils.smoothstep(n.y, -0.5, 0.2));
  const tail = (p: THREE.Vector3) => THREE.MathUtils.smoothstep(-p.z, -0.06, 0.26);
  const fin = (v: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  };
  return mergeGeometries([
    part(new THREE.SphereGeometry(1, 14, 8), skin, tail, mat4([0, 0, 0], [0.034, 0.05, 0.16])),
    // Forked tail, dorsal and a pair of pectoral fins.
    part(fin([0, 0, -0.14, 0, 0.065, -0.26, 0, 0.012, -0.21, 0, 0, -0.14, 0, -0.012, -0.21, 0, -0.065, -0.26]), flat('#ffffff'), tail, new THREE.Matrix4()),
    part(fin([0, 0.045, 0.03, 0, 0.085, -0.04, 0, 0.042, -0.07]), flat('#ffffff'), tail, new THREE.Matrix4()),
    part(fin([0.03, -0.015, 0.06, 0.07, -0.03, 0.02, 0.03, -0.02, 0.03]), flat('#e8e0c8'), none, new THREE.Matrix4()),
    part(fin([-0.03, -0.015, 0.06, -0.03, -0.02, 0.03, -0.07, -0.03, 0.02]), flat('#e8e0c8'), none, new THREE.Matrix4()),
  ])!;
}

/**
 * A dragonfly about 8 cm long facing +z: a slim abdomen, thorax and big-eyed head (white, tinted by the instance
 * color), and four glassy wings; aFlag is +1/-1 on the right/left wings (the shader flutters them), 0 on the body.
 */
function createDragonflyGeometry() {
  const body = new THREE.Color('#ffffff'), eye = new THREE.Color('#304050'), wing = new THREE.Color('#8fa8b0');
  const wingGeo = (side: number, z: number, len: number) => {
    const g = new THREE.BufferGeometry();
    const w = 0.0085;
    const v = [0, 0, z, side * len * 0.5, 0.002, z + w, side * len, 0.003, z + w * 0.3, side * len * 0.5, 0.002, z - w * 0.6];
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.computeVertexNormals();
    return part(g, () => wing, () => side, new THREE.Matrix4());
  };
  return mergeGeometries([
    part(new THREE.CylinderGeometry(0.0028, 0.0018, 0.06, 6), flat('#ffffff'), none, mat4([0, 0, -0.028], [1, 1, 1], [Math.PI / 2, 0, 0])),
    part(new THREE.SphereGeometry(1, 8, 6), () => body, none, mat4([0, 0, 0.008], [0.0055, 0.0055, 0.011])),
    part(new THREE.SphereGeometry(1, 8, 6), () => eye, none, mat4([0, 0.001, 0.021], [0.0062, 0.005, 0.005])),
    wingGeo(1, 0.012, 0.042),
    wingGeo(-1, 0.012, 0.042),
    wingGeo(1, 0.003, 0.038),
    wingGeo(-1, 0.003, 0.038),
  ])!;
}

interface Pad { pond: Pond; x: number; z: number; r: number; frog: boolean }
interface Frog {
  pond: Pond; x: number; y: number; z: number; yaw: number; scale: number;
  /** Seconds until the next hop; frogs mostly sit still. */
  wait: number;
  hop?: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t: number; dur: number; dive: boolean; pad?: Pad };
  pad?: Pad;
  /** Under water until this time, after a dive. */
  hidden: number;
}
interface Fish { pond: Pond; x: number; y: number; z: number; yaw: number; turn: number; speed: number; scale: number; depth: number; rest: number }
interface Dragonfly {
  pond: Pond; x: number; y: number; z: number; yaw: number;
  /** Where it is darting to, and whether it will touch the water there. */
  tx: number; ty: number; tz: number; dip: boolean;
  /** Seconds left hovering in place. */
  hover: number;
}

export class PondLife {
  readonly group = new THREE.Group();
  private uniforms = { uTime: { value: 0 } };
  private pads: Pad[] = [];
  private frogs: Frog[] = [];
  private fish: Fish[] = [];
  private shores = new Map<Pond, THREE.Vector2[]>();
  private frogMesh: THREE.InstancedMesh;
  private fishMesh: THREE.InstancedMesh;
  private flies: Dragonfly[] = [];
  private flyMesh: THREE.InstancedMesh;
  private rand: () => number;
  private matrix = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();
  private disposables: { dispose(): void }[] = [];
  private last = -1;

  constructor(private world: WorldFns) {
    this.rand = mulberry32(world.params.seed * 7 + 4049);
    for (const pond of world.ponds) {
      this.shores.set(pond, this.findShore(pond));
      this.placePads(pond);
    }
    this.group.add(this.createPads(), this.createFlowers());
    this.frogMesh = this.createFrogs();
    this.fishMesh = this.createFish();
    this.group.add(this.frogMesh, this.fishMesh);
    // Created last, so the pads, frogs and fish keep their seeded places.
    this.flyMesh = this.createDragonflies();
    this.group.add(this.flyMesh);
  }

  /** Points just up the bank all around a pond, where frogs can sit. */
  private findShore(pond: Pond) {
    const pts: THREE.Vector2[] = [];
    for (let k = 0; k < 40; k++) {
      const a = (k / 40) * Math.PI * 2;
      let r = pond.radius * 0.5;
      while (r < pond.radius * 2 && this.world.pondEdge(pond.x + Math.cos(a) * r, pond.z + Math.sin(a) * r) < 0.15) r += 0.1;
      pts.push(new THREE.Vector2(pond.x + Math.cos(a) * (r + 0.1), pond.z + Math.sin(a) * (r + 0.1)));
    }
    return pts;
  }

  /** Lily pads in a few rafts across the shallows, leaving most of the water open. */
  private placePads(pond: Pond) {
    const rand = this.rand;
    const rafts = 2 + Math.floor(rand() * 3);
    for (let k = 0; k < rafts; k++) {
      const a = rand() * Math.PI * 2, d = pond.radius * (0.35 + rand() * 0.45);
      const cx = pond.x + Math.cos(a) * d, cz = pond.z + Math.sin(a) * d;
      const count = 6 + Math.floor(rand() * 10);
      for (let i = 0; i < count * 3 && i < 60; i++) {
        const x = cx + (rand() - 0.5) * 3.2, z = cz + (rand() - 0.5) * 3.2;
        const r = 0.16 + rand() * 0.2;
        if (this.world.pondEdge(x, z) > -0.25 - r) continue;
        if (this.pads.some((p) => Math.hypot(p.x - x, p.z - z) < (p.r + r) * 0.85)) continue;
        this.pads.push({ pond, x, z, r, frog: false });
      }
    }
  }

  /** Patches a lit material's vertex stage with `body` (GLSL editing `transformed`; `aFlag` is the part weight). */
  private animate(material: THREE.Material, body: string) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aFlag;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nfloat seed = float(gl_InstanceID) * 1.618;\n${body}`);
    };
  }

  private createPads() {
    const geo = createPadGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    // A slow rocking on the ripples.
    this.animate(mat, `transformed.y += (transformed.x * sin(uTime * 0.9 + seed) + transformed.z * cos(uTime * 0.7 + seed * 1.3)) * 0.025;`);
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(this.pads.length, 1));
    mesh.count = this.pads.length;
    const tints = ['#ffffff', '#f0f4e0', '#e0e8c8', '#f4e0c0', '#ffffff', '#e8c8b0'].map((c) => new THREE.Color(c));
    this.pads.forEach((p, i) => {
      this.e.set(0, this.rand() * Math.PI * 2, 0);
      this.matrix.compose(this.v.set(p.x, p.pond.level + 0.012, p.z), this.q.setFromEuler(this.e), this.s.setScalar(p.r));
      mesh.setMatrixAt(i, this.matrix);
      mesh.setColorAt(i, tints[Math.floor(this.rand() * tints.length)]);
    });
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.disposables.push(geo, mat);
    return mesh;
  }

  private createFlowers() {
    const geo = createFlowerGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide });
    this.animate(mat, `transformed.y += sin(uTime * 0.9 + seed) * 0.004;`);
    const flowers = this.pads.filter(() => this.rand() < 0.3);
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(flowers.length, 1));
    mesh.count = flowers.length;
    const tints = ['#ffffff', '#ffffff', '#ffe8f0', '#ffc8dc'].map((c) => new THREE.Color(c));
    flowers.forEach((p, i) => {
      const a = this.rand() * Math.PI * 2;
      this.e.set(0, this.rand() * Math.PI * 2, 0);
      const x = p.x + Math.cos(a) * p.r * 0.4, z = p.z + Math.sin(a) * p.r * 0.4;
      this.matrix.compose(this.v.set(x, p.pond.level + 0.02, z), this.q.setFromEuler(this.e), this.s.setScalar(0.8 + this.rand() * 0.6));
      mesh.setMatrixAt(i, this.matrix);
      mesh.setColorAt(i, tints[Math.floor(this.rand() * tints.length)]);
    });
    mesh.frustumCulled = false;
    this.disposables.push(geo, mat);
    return mesh;
  }

  private createFrogs() {
    const geo = createFrogGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35 });
    // The throat sac swells in bursts of croaking.
    this.animate(
      mat,
      /* glsl */ `
        float croak = step(0.72, fract(uTime * 0.11 + seed)) * pow(max(sin(uTime * 9.0 + seed), 0.0), 2.0);
        transformed.y -= aFlag * croak * 0.014;
        transformed.xz += aFlag * croak * (transformed.xz - vec2(0.0, 0.045)) * 0.6;
      `,
    );
    const colors = ['#6f9a2e', '#7fa636', '#8a7a40', '#5f8e30', '#94a040'].map((c) => new THREE.Color(c));
    for (const pond of this.world.ponds) {
      const n = 3 + Math.floor(this.rand() * 3);
      const pads = this.pads.filter((p) => p.pond === pond && p.r > 0.22);
      const shore = this.shores.get(pond)!;
      for (let i = 0; i < n; i++) {
        const frog: Frog = { pond, x: 0, y: 0, z: 0, yaw: this.rand() * Math.PI * 2, scale: 1.2 + this.rand() * 0.6, wait: 2 + this.rand() * 12, hidden: 0 };
        const pad = this.rand() < 0.5 ? pads.find((p) => !p.frog) : undefined;
        if (pad) this.sitOnPad(frog, pad);
        else this.sitOnShore(frog, shore[Math.floor(this.rand() * shore.length)]);
        this.frogs.push(frog);
      }
    }
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(this.frogs.length, 1));
    mesh.count = this.frogs.length;
    this.frogs.forEach((_, i) => mesh.setColorAt(i, colors[Math.floor(this.rand() * colors.length)]));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    this.disposables.push(geo, mat);
    return mesh;
  }

  private createFish() {
    const geo = createFishGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.15, side: THREE.DoubleSide });
    // Swim: a wave travels down the body, growing toward the tail.
    this.animate(
      mat,
      /* glsl */ `
        float wave = sin(uTime * 5.0 + seed * 3.0 + transformed.z * 14.0);
        transformed.x += wave * (0.006 + 0.05 * aFlag);
      `,
    );
    const colors = ['#c8742a', '#d8902e', '#b85a26', '#6a6640', '#8c8a78', '#d0a040'].map((c) => new THREE.Color(c));
    for (const pond of this.world.ponds) {
      const n = Math.round(pond.radius * 0.55);
      for (let i = 0; i < n; i++) {
        const a = this.rand() * Math.PI * 2, d = this.rand() * pond.radius * 0.6;
        this.fish.push({
          pond, x: pond.x + Math.cos(a) * d, y: pond.level - 0.4, z: pond.z + Math.sin(a) * d,
          yaw: this.rand() * Math.PI * 2, turn: 0, speed: 0.12 + this.rand() * 0.2, scale: 0.7 + this.rand() * 0.6,
          depth: 0.1 + this.rand() * 0.3, rest: this.rand() * 5,
        });
      }
    }
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(this.fish.length, 1));
    mesh.count = this.fish.length;
    this.fish.forEach((_, i) => mesh.setColorAt(i, colors[Math.floor(this.rand() * colors.length)]));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.disposables.push(geo, mat);
    return mesh;
  }

  private createDragonflies() {
    const geo = createDragonflyGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.45, side: THREE.DoubleSide, alphaHash: true });
    // Wings beat too fast to see: a shimmering flutter about the body's long axis.
    this.animate(mat, `transformed.y += abs(aFlag) * abs(transformed.x) * sin(uTime * 95.0 + seed * 5.0 + step(transformed.z, 0.008) * 1.7) * 0.35;`);
    // The wings stay glassy whatever the body's color (the instance tint would paint them too).
    const patchAnimate = mat.onBeforeCompile;
    mat.onBeforeCompile = (shader, renderer) => {
      patchAnimate.call(mat, shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying float vWing;')
        .replace('#include <color_vertex>', '#include <color_vertex>\nvWing = step(0.5, abs(aFlag));\nif (vWing > 0.5) vColor.rgb = vec3(0.36, 0.42, 0.45);');
      // Wings are thin clear film: mostly see-through (hashed alpha, which the TAA smooths) and not metal, so in
      // full sun they don't read as white blades.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vWing;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a = mix(diffuseColor.a, 0.45, vWing);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1.0 - vWing;\nroughnessFactor = mix(roughnessFactor, 0.7, vWing);');
    };
    mat.customProgramCacheKey = () => 'dragonfly';
    const colors = ['#2f6fd8', '#3aa0c8', '#3c9a48', '#c8452c', '#2f6fd8'].map((c) => new THREE.Color(c));
    for (const pond of this.world.ponds) {
      const n = 2 + Math.floor(this.rand() * 3);
      for (let i = 0; i < n; i++) {
        const a = this.rand() * Math.PI * 2, d = this.rand() * pond.radius * 0.7;
        const x = pond.x + Math.cos(a) * d, z = pond.z + Math.sin(a) * d, y = pond.level + 0.4 + this.rand() * 0.6;
        this.flies.push({ pond, x, y, z, yaw: this.rand() * Math.PI * 2, tx: x, ty: y, tz: z, dip: false, hover: this.rand() * 3 });
      }
    }
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(this.flies.length, 1));
    mesh.count = this.flies.length;
    this.flies.forEach((_, i) => mesh.setColorAt(i, colors[Math.floor(this.rand() * colors.length)]));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    this.disposables.push(geo, mat);
    return mesh;
  }

  /** Where the dragonflies are drawn to (the demo's pond shot), and on which pond. */
  private lurePoint: THREE.Vector3 | null = null;
  private lurePond: Pond | null = null;

  /**
   * Draws the nearest pond's dragonflies (and a few more) to hover and dart around `at`, a little over the water, so
   * a close shot can hold them; null lets them go back to roaming their pond.
   */
  lure(at: THREE.Vector3 | null) {
    this.lurePoint = at?.clone() ?? null;
    this.lurePond = null;
    if (!at) return;
    let best = Infinity;
    for (const p of this.world.ponds) {
      const d = Math.hypot(p.x - at.x, p.z - at.z) - p.radius;
      if (d < best) (best = d), (this.lurePond = p);
    }
    const pond = this.lurePond;
    if (!pond) return;
    // Bring them in close (they keep their own colors), each at its own spot around the lure.
    const near = this.flies.filter((f) => f.pond === pond);
    for (const [i, f] of near.entries()) {
      const a = (i / near.length) * Math.PI * 2;
      f.x = f.tx = at.x + Math.cos(a) * 0.9;
      f.z = f.tz = at.z + Math.sin(a) * 0.9;
      f.y = f.ty = at.y + (this.rand() - 0.5) * 0.3;
      f.hover = this.rand() * 1.5;
    }
  }

  /** Dragonflies hover, dart a metre or two to a new spot, and sometimes dip to touch the water. */
  private stepFly(f: Dragonfly, time: number, dt: number) {
    const p = f.pond;
    if (f.hover > 0) {
      f.hover -= dt;
      if (f.hover <= 0 && this.lurePoint && p === this.lurePond) {
        // Lured: short darts around the lure, between hovers.
        const L = this.lurePoint, a = this.rand() * Math.PI * 2, d = 0.3 + this.rand() * 1.3;
        f.tx = L.x + Math.cos(a) * d;
        f.tz = L.z + Math.sin(a) * d;
        f.dip = this.world.pondEdge(f.tx, f.tz) < -0.4 && this.rand() < 0.12;
        f.ty = f.dip ? p.level + 0.015 : L.y + (this.rand() - 0.5) * 0.5;
      } else if (f.hover <= 0) {
        // Next spot: over the water or along the margin, near where it is.
        const a = this.rand() * Math.PI * 2, d = 0.8 + this.rand() * 2.2;
        let tx = f.x + Math.cos(a) * d, tz = f.z + Math.sin(a) * d;
        if (Math.hypot(tx - p.x, tz - p.z) > p.radius * 1.05) {
          tx = f.x + (p.x - f.x) * 0.4;
          tz = f.z + (p.z - f.z) * 0.4;
        }
        f.dip = this.world.pondEdge(tx, tz) < -0.4 && this.rand() < 0.18;
        f.tx = tx;
        f.tz = tz;
        f.ty = f.dip ? p.level + 0.015 : p.level + 0.3 + this.rand() * 0.9;
      }
      return;
    }
    const dx = f.tx - f.x, dy = f.ty - f.y, dz = f.tz - f.z, d = Math.hypot(dx, dy, dz);
    const step = Math.min(d, (f.dip ? 2.2 : 3.6) * dt);
    if (d > 1e-3) {
      f.x += (dx / d) * step;
      f.y += (dy / d) * step;
      f.z += (dz / d) * step;
      if (Math.hypot(dx, dz) > 0.05) f.yaw = Math.atan2(dx, dz);
    }
    if (d - step < 0.01) {
      if (f.dip) {
        addRipple(f.x, f.z, time, 0.3);
        f.dip = false;
        // Straight back up after touching the water.
        f.ty = p.level + 0.4 + this.rand() * 0.5;
        f.tx = f.x;
        f.tz = f.z;
        return;
      }
      f.hover = 0.6 + this.rand() * 2.8;
    }
  }

  private sitOnPad(frog: Frog, pad: Pad) {
    if (frog.pad) frog.pad.frog = false;
    frog.pad = pad;
    pad.frog = true;
    frog.x = pad.x;
    frog.z = pad.z;
    frog.y = pad.pond.level + 0.02;
  }

  private sitOnShore(frog: Frog, p: THREE.Vector2) {
    if (frog.pad) frog.pad.frog = false;
    frog.pad = undefined;
    frog.x = p.x;
    frog.z = p.y;
    frog.y = this.world.height(p.x, p.y);
    // Face the water.
    frog.yaw = Math.atan2(frog.pond.x - p.x, frog.pond.z - p.y) + (this.rand() - 0.5) * 1.2;
  }

  private startHop(frog: Frog, x: number, y: number, z: number, dive: boolean, pad?: Pad) {
    if (frog.pad) frog.pad.frog = false;
    frog.pad = undefined;
    if (pad) pad.frog = true;
    const dist = Math.hypot(x - frog.x, z - frog.z);
    frog.yaw = Math.atan2(x - frog.x, z - frog.z);
    frog.hop = { x0: frog.x, y0: frog.y, z0: frog.z, x1: x, y1: y, z1: z, t: 0, dur: 0.25 + dist * 0.12, dive, pad };
  }

  /** Picks where a frog goes next: another pad or a spot on the bank, within a couple of hops' reach. */
  private wander(frog: Frog) {
    const near = (x: number, z: number) => Math.hypot(x - frog.x, z - frog.z) < 2.6;
    const pads = this.pads.filter((p) => p.pond === frog.pond && !p.frog && p.r > 0.2 && near(p.x, p.z));
    const shore = this.shores.get(frog.pond)!.filter((p) => near(p.x, p.y));
    if (pads.length && (this.rand() < 0.6 || !shore.length)) {
      const p = pads[Math.floor(this.rand() * pads.length)];
      this.startHop(frog, p.x, p.pond.level + 0.02, p.z, false, p);
    } else if (shore.length) {
      const p = shore[Math.floor(this.rand() * shore.length)];
      this.startHop(frog, p.x, this.world.height(p.x, p.y), p.y, false);
    }
  }

  /** `day` 0..1 is daylight: dragonflies only fly by day. */
  update(time: number, viewer: THREE.Vector3, day = 1) {
    const dt = this.last < 0 ? 0 : Math.min(time - this.last, 0.1);
    this.last = time;
    this.uniforms.uTime.value = time;
    const active = (p: Pond) => Math.hypot(p.x - viewer.x, p.z - viewer.z) < 160;
    const m = this.matrix;

    this.frogs.forEach((f, i) => {
      if (active(f.pond)) this.stepFrog(f, time, dt, viewer);
      const hidden = time < f.hidden;
      let pitch = 0, y = f.y;
      if (f.hop) {
        const h = f.hop, t = h.t;
        f.x = h.x0 + (h.x1 - h.x0) * t;
        f.z = h.z0 + (h.z1 - h.z0) * t;
        y = h.y0 + (h.y1 - h.y0) * t + Math.sin(Math.PI * t) * (0.12 + 0.08 * Math.hypot(h.x1 - h.x0, h.z1 - h.z0));
        pitch = -0.7 * Math.cos(Math.PI * t);
      }
      this.e.set(pitch, f.yaw, 0, 'YXZ');
      m.compose(this.v.set(f.x, y, f.z), this.q.setFromEuler(this.e), this.s.setScalar(hidden ? 0 : f.scale));
      this.frogMesh.setMatrixAt(i, m);
    });
    this.frogMesh.instanceMatrix.needsUpdate = true;

    this.fish.forEach((f, i) => {
      if (active(f.pond)) this.stepFish(f, time, dt);
      this.e.set(0, f.yaw, Math.sin(time * 0.7 + i) * 0.05, 'YXZ');
      m.compose(this.v.set(f.x, f.y, f.z), this.q.setFromEuler(this.e), this.s.setScalar(f.scale));
      this.fishMesh.setMatrixAt(i, m);
    });
    this.fishMesh.instanceMatrix.needsUpdate = true;

    const out = day < 0.3;
    this.flies.forEach((f, i) => {
      const near = Math.hypot(f.pond.x - viewer.x, f.pond.z - viewer.z) < 90;
      if (near && !out) this.stepFly(f, time, dt);
      // A hovering dragonfly is never quite still.
      const bob = f.hover > 0 ? Math.sin(time * 3.1 + i * 1.7) * 0.012 : 0;
      this.e.set(f.hover > 0 ? 0 : -0.08, f.yaw, Math.sin(time * 2.3 + i) * 0.06, 'YXZ');
      m.compose(this.v.set(f.x, f.y + bob, f.z), this.q.setFromEuler(this.e), this.s.setScalar(near && !out ? 1.15 : 0));
      this.flyMesh.setMatrixAt(i, m);
    });
    this.flyMesh.instanceMatrix.needsUpdate = true;
  }

  private stepFrog(f: Frog, time: number, dt: number, viewer: THREE.Vector3) {
    if (time < f.hidden) return;
    if (f.hidden > 0) {
      // Surface again on a free pad, or on the bank if every pad is taken.
      f.hidden = 0;
      const pads = this.pads.filter((p) => p.pond === f.pond && !p.frog && p.r > 0.2);
      if (pads.length) {
        const pad = pads[Math.floor(this.rand() * pads.length)];
        this.sitOnPad(f, pad);
        // Climbing back out onto a pad stirs the water a little.
        addRipple(pad.x, pad.z, time, 0.35);
      } else this.sitOnShore(f, this.shores.get(f.pond)![Math.floor(this.rand() * 40)]);
      f.wait = 4 + this.rand() * 8;
      return;
    }
    if (f.hop) {
      f.hop.t = Math.min(f.hop.t + dt / f.hop.dur, 1);
      if (f.hop.t >= 1) {
        const h = f.hop;
        f.hop = undefined;
        f.x = h.x1;
        f.y = h.y1;
        f.z = h.z1;
        if (h.pad) f.pad = h.pad;
        if (h.dive) {
          f.hidden = time + 6 + this.rand() * 10;
          addRipple(h.x1, h.z1, time, 1);
        } else if (h.pad) addRipple(h.x1, h.z1, time, 0.25);
      }
      return;
    }
    // Startled: leap away from the viewer into the water.
    const dx = f.x - viewer.x, dz = f.z - viewer.z, dist = Math.hypot(dx, dz);
    if (dist < 3.5 && Math.abs(viewer.y - f.y) < 4) {
      const p = f.pond;
      let tx = f.x + (dx / dist) * 1.4 + (p.x - f.x) * 0.3, tz = f.z + (dz / dist) * 1.4 + (p.z - f.z) * 0.3;
      if (this.world.pondEdge(tx, tz) > -0.3) {
        tx = f.x + (p.x - f.x) * 0.5;
        tz = f.z + (p.z - f.z) * 0.5;
      }
      if (f.pad) f.pad.frog = false;
      this.startHop(f, tx, p.level - 0.05, tz, true);
      return;
    }
    f.wait -= dt;
    if (f.wait <= 0) {
      f.wait = 5 + this.rand() * 14;
      this.wander(f);
    }
  }

  private stepFish(f: Fish, time: number, dt: number) {
    const p = f.pond;
    if (f.rest > 0) {
      // Hanging still in the water, finning gently.
      f.rest -= dt;
    } else {
      // Wander: the heading drifts; steer back toward deeper water when the bank or the bed gets close.
      f.turn += (this.rand() - 0.5) * dt * 1.5;
      f.turn *= 0.98;
      const ax = f.x + Math.sin(f.yaw) * 0.8, az = f.z + Math.cos(f.yaw) * 0.8;
      if (this.world.pondEdge(ax, az) > -0.7 || this.world.height(ax, az) > p.level - 0.3) {
        const toCenter = Math.atan2(p.x - f.x, p.z - f.z);
        let d = toCenter - f.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        f.turn = Math.sign(d) * 0.9;
      }
      f.yaw += f.turn * dt;
      f.x += Math.sin(f.yaw) * f.speed * dt;
      f.z += Math.cos(f.yaw) * f.speed * dt;
      if (this.rand() < dt * 0.08) f.rest = 1 + this.rand() * 4;
    }
    // Some cruise just under the surface, others nearer the bed; they drift between depths over time.
    if (this.rand() < dt * 0.05) f.depth = 0.1 + this.rand() * 0.3;
    // Now and then one cruising just under the surface rises to sip something off it.
    if (f.depth < 0.18 && this.rand() < dt * 0.025) addRipple(f.x + Math.sin(f.yaw) * 0.15, f.z + Math.cos(f.yaw) * 0.15, time, 0.55);
    const bed = this.world.height(f.x, f.z) + 0.1;
    const target = Math.max(p.level - f.depth, bed);
    f.y += (Math.min(target, p.level - 0.08) - f.y) * Math.min(dt * 0.8, 1);
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
  }
}
