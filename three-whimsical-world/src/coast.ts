import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { WorldFns } from './worldgen';
import { addRipple } from './water';
import { WIND_DIR, wind } from './wind';

/**
 * Life along the coast (the sea lies toward +x):
 *
 * - Gulls: white with grey backs and black wingtips, soaring over the shallows near you on wide circles, gliding
 *   with now and then a few wingbeats. Every so often one folds its wings and plunges into the sea for a fish, sits a
 *   moment bobbing on the swell, then labors back up into the circle.
 * - A whale far offshore, every minute or so while you're near the coast: it blows a column of mist, rolls its back
 *   through the swell a few times, then dives with its flukes raised and streaming. One surfacing in four is a full
 *   breach instead: it launches most of its length out of the water, twists, and crashes back in.
 * - Seals hauled out at the water's edge in small colonies, lying on the sand; now and then one lifts its head and
 *   tail (the "banana" pose) and looks about.
 *
 * Spray (blows, splashes, drips) is drawn in the overlay after the haze, each particle tested against the scene's
 * depth, so the water surface doesn't refract it away.
 */

const GULLS = 7;
const SEALS = 9;
const SPRAY = 900;

// --- Geometry helpers ---------------------------------------------------------------------------------------------

/** Adds a vertex color attribute from `fn(position, normal)`, and drops uvs so geometries merge. */
function paint(geo: THREE.BufferGeometry, fn: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const c = fn(p, n);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** A body of revolution along +z from a profile of (z, radius) pairs; `squash` flattens it vertically. */
function lathe(profile: [number, number][], segments: number, squash = 1) {
  const pts = profile.map(([z, r]) => new THREE.Vector2(Math.max(r, 0.001), z));
  const g = new THREE.LatheGeometry(pts, segments);
  g.rotateX(Math.PI / 2); // lathe axis y -> z
  g.scale(1, squash, 1);
  return g;
}

/** A flat shape in the xz plane (shape y -> z), thin, double-sided by its material. */
function flat(points: [number, number][]) {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(Math.PI / 2);
  return g;
}

// --- Spray --------------------------------------------------------------------------------------------------------

interface EmitOptions {
  count: number;
  /** Speed range (m/s) and a direction it's spread around (unit), within `spread` (radians). */
  speed: [number, number];
  dir: THREE.Vector3;
  spread: number;
  /** Particle size range (m), lifetime (s), gravity (m/s²) and air drag (1/s). */
  size: [number, number];
  life: [number, number];
  gravity: number;
  drag: number;
  /** Start scattered within this radius (m). */
  radius?: number;
  /** Drift with the wind (m/s per unit of wind strength). */
  windDrift?: number;
}

class Spray {
  readonly points: THREE.Points;
  private pos = new Float32Array(SPRAY * 3);
  private info = new Float32Array(SPRAY * 3); // age 0..1 (or -1 dead), size, opacity
  private vel = new Float32Array(SPRAY * 3);
  private life = new Float32Array(SPRAY);
  private age = new Float32Array(SPRAY).fill(1e9);
  private grav = new Float32Array(SPRAY);
  private drag = new Float32Array(SPRAY);
  private drift = new Float32Array(SPRAY);
  private next = 0;
  readonly uniforms = {
    tDepth: { value: null as THREE.Texture | null },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uPixelsPerMeter: { value: 600 },
    uLight: { value: new THREE.Color(1, 1, 1) },
  };

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aInfo', new THREE.BufferAttribute(this.info, 3).setUsage(THREE.DynamicDrawUsage));
    for (let i = 0; i < SPRAY; i++) this.info[i * 3] = -1;
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      vertexShader: /* glsl */ `
        uniform sampler2D tDepth;
        uniform float uNear, uFar, uPixelsPerMeter;
        attribute vec3 aInfo;
        varying float vAlpha;
        float viewZ(float d) { return uNear * uFar / (uFar - d * (uFar - uNear)); }
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          float age = aInfo.x;
          // Puffs swell as they age and thin out toward the end.
          float size = aInfo.y * (0.6 + 0.8 * sqrt(max(age, 0.0)));
          vAlpha = age < 0.0 ? 0.0 : aInfo.z * smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(0.45, 1.0, age));
          vec3 ndc = gl_Position.xyz / gl_Position.w;
          if (vAlpha > 0.0 && all(lessThan(abs(ndc.xy), vec2(1.0))) && gl_Position.w > 0.0) {
            float scene = viewZ(texture(tDepth, ndc.xy * 0.5 + 0.5).x);
            if (scene < dist - size) vAlpha = 0.0;
          }
          gl_PointSize = vAlpha > 0.0 ? max(size * uPixelsPerMeter / max(dist, 0.1), 1.5) : 0.0;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uLight;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = (1.0 - smoothstep(0.3, 1.0, d)) * vAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uLight, a);
        }
      `,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
  }

  emit(at: THREE.Vector3, o: EmitOptions) {
    const d = new THREE.Vector3(), t = new THREE.Vector3(), b = new THREE.Vector3();
    // A frame around the direction, for the spread.
    t.set(0, 1, 0);
    if (Math.abs(o.dir.y) > 0.9) t.set(1, 0, 0);
    t.cross(o.dir).normalize();
    b.crossVectors(o.dir, t);
    for (let k = 0; k < o.count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % SPRAY;
      const a = Math.random() * Math.PI * 2, s = Math.sqrt(Math.random()) * Math.tan(o.spread);
      d.copy(o.dir).addScaledVector(t, Math.cos(a) * s).addScaledVector(b, Math.sin(a) * s).normalize();
      const speed = o.speed[0] + Math.random() * (o.speed[1] - o.speed[0]);
      const r = (o.radius ?? 0) * Math.sqrt(Math.random()), ra = Math.random() * Math.PI * 2;
      this.pos.set([at.x + Math.cos(ra) * r, at.y, at.z + Math.sin(ra) * r], i * 3);
      this.vel.set([d.x * speed, d.y * speed, d.z * speed], i * 3);
      this.life[i] = o.life[0] + Math.random() * (o.life[1] - o.life[0]);
      this.age[i] = 0;
      this.grav[i] = o.gravity;
      this.drag[i] = o.drag;
      this.drift[i] = o.windDrift ?? 0;
      this.info[i * 3 + 1] = o.size[0] + Math.random() * (o.size[1] - o.size[0]);
      this.info[i * 3 + 2] = 0.25 + 0.25 * Math.random();
    }
  }

  update(dt: number) {
    const w = wind.uWindStrength.value;
    for (let i = 0; i < SPRAY; i++) {
      if (this.age[i] >= this.life[i]) {
        this.info[i * 3] = -1;
        continue;
      }
      this.age[i] += dt;
      const k = Math.exp(-this.drag[i] * dt);
      const j = i * 3;
      // Drag pulls the velocity toward the wind's; gravity pulls down.
      const wx = WIND_DIR.x * w * this.drift[i], wz = WIND_DIR.y * w * this.drift[i];
      this.vel[j] = wx + (this.vel[j] - wx) * k;
      this.vel[j + 1] = this.vel[j + 1] * k - this.grav[i] * dt;
      this.vel[j + 2] = wz + (this.vel[j + 2] - wz) * k;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      // Falling drops end at the sea.
      if (this.pos[j + 1] < -0.2 && this.vel[j + 1] < 0) this.age[i] = this.life[i];
      this.info[j] = Math.min(this.age[i] / this.life[i], 1);
    }
    const g = this.points.geometry;
    g.getAttribute('position').needsUpdate = true;
    g.getAttribute('aInfo').needsUpdate = true;
  }

  dispose() {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
  }
}

// --- Gulls --------------------------------------------------------------------------------------------------------

function gullGeometry() {
  const white = new THREE.Color(0.95, 0.95, 0.93), grey = new THREE.Color(0.6, 0.64, 0.7), black = new THREE.Color(0.06, 0.06, 0.07);
  const beak = new THREE.Color(0.95, 0.75, 0.2);
  const p: number[] = [], c: number[] = [];
  const tri = (a: number[], b: number[], d: number[], col: THREE.Color | THREE.Color[]) => {
    p.push(...a, ...b, ...d);
    const cs = Array.isArray(col) ? col : [col, col, col];
    for (const x of cs) c.push(x.r, x.g, x.b);
  };
  // Wings: an inner panel and an outer one tapering to a black tip, each side; the leading edge stays white.
  for (const k of [-1, 1]) {
    const s0 = [0.05 * k, 0, 0.1], s1 = [0.05 * k, 0, -0.1];
    const e0 = [0.38 * k, 0, 0.08], e1 = [0.38 * k, 0, -0.12];
    const t0 = [0.62 * k, 0, 0.02], t1 = [0.6 * k, 0, -0.07], tip = [0.78 * k, 0, -0.06];
    tri(s0, e0, e1, [white, white, grey]);
    tri(s0, e1, s1, [white, grey, grey]);
    tri(e0, t0, t1, [white, grey, grey]);
    tri(e0, t1, e1, [white, grey, grey]);
    tri(t0, tip, t1, black);
  }
  // Body: a spindle from the tail to the head, as two crossed diamonds; a beak; a tail fan.
  tri([0, 0, 0.3], [0.06, 0, 0.05], [0, 0, -0.25], white);
  tri([0, 0, 0.3], [-0.06, 0, 0.05], [0, 0, -0.25], white);
  tri([0, 0.0, 0.3], [0, 0.07, 0.05], [0, -0.05, -0.25], white);
  tri([0, 0.0, 0.3], [0, -0.06, 0.05], [0, 0.05, -0.25], white);
  tri([0, 0.01, 0.3], [0.012, 0, 0.38], [-0.012, 0, 0.3], beak);
  tri([0, 0, -0.2], [0.09, 0, -0.38], [-0.09, 0, -0.38], white);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  g.computeVertexNormals();
  // Normals up, so the flat wings shade as a surface lit from the sky rather than edge-on black.
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

type GullMode = 'soar' | 'dive' | 'sit' | 'rise';
interface Gull {
  theta: number;
  omega: number;
  radius: number;
  alt: number;
  seed: number;
  mode: GullMode;
  t: number;
  dur: number;
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  p2: THREE.Vector3;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  yaw: number;
  roll: number;
  nextDive: number;
}

// --- Whale --------------------------------------------------------------------------------------------------------

function whaleParts() {
  const top = new THREE.Color(0.09, 0.1, 0.12), belly = new THREE.Color(0.55, 0.57, 0.6), fin = new THREE.Color(0.72, 0.74, 0.76);
  const skin = (p: THREE.Vector3, n: THREE.Vector3) => top.clone().lerp(belly, THREE.MathUtils.smoothstep(-n.y, 0.25, 0.75));
  const squash = 0.85;
  // Front half: from the middle to the snout (humpback-like: a broad head tapering to a flat rostrum).
  const front = lathe([[0, 1.55], [1.5, 1.62], [3, 1.55], [4.5, 1.3], [5.6, 1.0], [6.4, 0.65], [6.9, 0.3], [7.05, 0.02]], 18, squash);
  // Long pale flippers, swept back and down.
  const flipper = (k: number) => {
    const g = flat([[0, 0.5], [0.4 * k, 0.6], [3.6 * k, -1.2], [3.9 * k, -1.6], [3.4 * k, -1.5], [0, -0.3]]);
    g.rotateZ(-0.5 * k);
    g.translate(1.2 * k, -0.7, 3.4);
    return g;
  };
  const frontGeo = mergeGeometries([paint(front, skin), paint(flipper(1), () => fin), paint(flipper(-1), () => fin)])!;
  // Rear half: the tail stock narrowing to the peduncle, a small dorsal fin, and the flukes.
  const rear = lathe([[-7.0, 0.22], [-6.4, 0.32], [-5.4, 0.5], [-4.0, 0.9], [-2.0, 1.32], [0, 1.55]], 18, squash);
  // A small dorsal fin: one upright triangle.
  const dorsalGeo = new THREE.BufferGeometry();
  dorsalGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.2, -2.0, 0, 1.75, -3.0, 0, 1.15, -3.4], 3));
  dorsalGeo.computeVertexNormals();
  const flukePts: [number, number][] = [];
  const half: [number, number][] = [[0.0, 0.25], [0.7, 0.05], [1.6, -0.25], [2.3, -0.75], [2.35, -0.95], [1.9, -0.92], [1.2, -0.85], [0.45, -1.0], [0.0, -0.8]];
  for (const [x, z] of half) flukePts.push([x, z]);
  for (const [x, z] of [...half].reverse().slice(1, -1)) flukePts.push([-x, z]);
  const flukes = flat(flukePts);
  flukes.translate(0, 0, -6.8);
  const rearGeo = mergeGeometries([paint(rear, skin), paint(dorsalGeo, () => top), paint(flukes, () => top.clone().lerp(belly, 0.3))])!;
  return { frontGeo, rearGeo };
}

type WhaleKind = 'blow' | 'breach';

// --- Seals --------------------------------------------------------------------------------------------------------

function sealGeometry() {
  const base = new THREE.Color(0.25, 0.23, 0.21), dark = new THREE.Color(0.08, 0.075, 0.075), belly = new THREE.Color(0.4, 0.37, 0.33);
  // Lying on its belly along +z (head), the body resting on y = 0.
  const body = lathe([[-0.85, 0.05], [-0.7, 0.12], [-0.45, 0.22], [-0.1, 0.29], [0.25, 0.27], [0.5, 0.18], [0.62, 0.155], [0.74, 0.16], [0.84, 0.11], [0.92, 0.05], [0.95, 0.01]], 22, 0.82);
  body.translate(0, 0.23, 0);
  // The coat's mottling is painted per pixel in the shader; here only the paler belly.
  const bodyGeo = paint(body, (_p, n) => base.clone().lerp(belly, THREE.MathUtils.smoothstep(-n.y, -0.1, 0.5)));
  // Eyes: two dark dabs on the head.
  const eye = (k: number) => {
    const g = new THREE.SphereGeometry(0.025, 6, 4);
    g.translate(0.09 * k, 0.33, 0.8);
    return paint(g, () => new THREE.Color(0.02, 0.02, 0.02));
  };
  // Hind flippers fanned behind, fore flippers at the sides.
  const hind = (k: number) => {
    const g = flat([[0, -0.78], [0.18 * k, -1.08], [0.05 * k, -1.12], [-0.02 * k, -0.8]]);
    g.translate(0, 0.1, 0);
    return paint(g, () => dark);
  };
  const fore = (k: number) => {
    const g = flat([[0.2 * k, 0.32], [0.38 * k, 0.12], [0.3 * k, 0.08], [0.18 * k, 0.24]]);
    g.translate(0, 0.04, 0);
    return paint(g, () => dark);
  };
  return mergeGeometries([bodyGeo, eye(1), eye(-1), hind(1), hind(-1), fore(1), fore(-1)])!;
}

// --- Coast life ---------------------------------------------------------------------------------------------------

export class CoastLife {
  readonly group = new THREE.Group();
  /** For the overlay scene (drawn after the haze); see `setSceneDepth`. */
  readonly overlay = new THREE.Group();
  private spray = new Spray();
  private gullMesh: THREE.InstancedMesh;
  private gulls: Gull[] = [];
  private gullCenter = new THREE.Vector3(1e9, 0, 0);
  private whale = new THREE.Group();
  private whaleRear = new THREE.Group();
  private whaleState: { kind: WhaleKind; t: number; origin: THREE.Vector3; heading: THREE.Vector3; blows: Set<number> } | null = null;
  private nextWhale = 25;
  private sealMesh: THREE.InstancedMesh;
  private sealCenter = new THREE.Vector3(1e9, 0, 0);
  private sealUniforms = { uTime: { value: 0 } };
  private shoreCache = new Map<number, number | null>();
  private time = 0;
  private disposables: { dispose(): void }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private v = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);

  constructor(private fns: WorldFns) {
    this.overlay.add(this.spray.points);

    // Gulls.
    const gullGeo = gullGeometry();
    gullGeo.setAttribute('aPose', new THREE.InstancedBufferAttribute(new Float32Array(GULLS * 2), 2).setUsage(THREE.DynamicDrawUsage));
    const gullMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 });
    gullMat.onBeforeCompile = (shader) => {
      // Both faces keep the upward normal (a flipped one would light the underside from the ground and tint it
      // olive); the underside instead glows faintly with the light the sea throws back up at it.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal *= faceDirection;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  if (!gl_FrontFacing) totalEmissiveRadiance += diffuseColor.rgb * vec3(0.16, 0.19, 0.24);');
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aPose;')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          // Wings: the inner panel rises with the beat, the outer one hangs lower (a gull's crooked "M"); folding
          // pulls them in and sweeps them back along the body for a dive.
          float ax = abs(transformed.x);
          if (ax > 0.051) {
            float side = sign(transformed.x);
            float fold = aPose.y;
            float span = mix(ax, 0.05 + (ax - 0.05) * 0.3, fold) - 0.05;
            float inner = min(span, 0.33 * mix(1.0, 0.3, fold));
            float outerLen = max(span - inner, 0.0);
            float a1 = mix(aPose.x, 0.35, fold);
            float a2 = a1 + mix(-0.5 + 0.55 * aPose.x, -0.2, fold);
            vec2 q = vec2(cos(a1), sin(a1)) * inner + vec2(cos(a2), sin(a2)) * outerLen;
            transformed = vec3(side * (0.05 + q.x), transformed.y + q.y, transformed.z - fold * (ax - 0.05) * 0.7);
          }`,
        );
    };
    this.gullMesh = new THREE.InstancedMesh(gullGeo, gullMat, GULLS);
    this.gullMesh.frustumCulled = false;
    this.gullMesh.visible = false;
    for (let i = 0; i < GULLS; i++) {
      this.gulls.push({
        theta: Math.random() * Math.PI * 2, omega: (0.16 + Math.random() * 0.12) * (Math.random() < 0.5 ? 1 : -1),
        radius: 14 + Math.random() * 30, alt: 9 + Math.random() * 14, seed: Math.random() * 100,
        mode: 'soar', t: 0, dur: 1, p0: new THREE.Vector3(), p1: new THREE.Vector3(), p2: new THREE.Vector3(),
        pos: new THREE.Vector3(), prev: new THREE.Vector3(), yaw: 0, roll: 0, nextDive: 8 + Math.random() * 25,
      });
    }
    this.disposables.push(gullGeo, gullMat);

    // The whale: the front half on the group, the rear half on a pivot at the middle so the tail can arch.
    const { frontGeo, rearGeo } = whaleParts();
    const whaleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, side: THREE.DoubleSide });
    this.whale.add(new THREE.Mesh(frontGeo, whaleMat), this.whaleRear);
    this.whaleRear.add(new THREE.Mesh(rearGeo, whaleMat));
    this.whale.visible = false;
    this.disposables.push(frontGeo, rearGeo, whaleMat);

    // Seals.
    const sealGeo = sealGeometry();
    sealGeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(SEALS).map(() => Math.random()), 1));
    const sealMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, side: THREE.DoubleSide });
    sealMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.sealUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aSeed;\nvarying vec3 vCoat;')
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          vCoat = position * 7.0 + aSeed * 40.0;
          // The "banana": now and then head and tail lift off the sand together; the head turns to look about,
          // and the body swells with slow breaths.
          float t = uTime + aSeed * 97.0;
          float banana = smoothstep(0.55, 0.95, sin(t * 0.17 + aSeed * 11.0));
          float u = transformed.z;
          transformed.y += banana * (0.32 * pow(max(u - 0.1, 0.0), 1.6) + 0.22 * pow(max(-u - 0.3, 0.0), 1.5));
          float breath = 1.0 + 0.025 * sin(t * 1.3) * smoothstep(0.6, 0.0, abs(u + 0.1));
          transformed.xy = vec2(transformed.x * breath, 0.23 + (transformed.y - 0.23) * breath);
          if (u > 0.45) {
            float look = (0.5 * sin(t * 0.31) + 0.25 * sin(t * 0.83)) * (0.4 + 0.6 * banana);
            float w = smoothstep(0.45, 0.65, u) * look;
            vec2 r = vec2(transformed.x, u - 0.45);
            transformed.x = r.x * cos(w) + r.y * sin(w);
            transformed.z = 0.45 - r.x * sin(w) + r.y * cos(w);
          }`,
        );
      // A harbour seal's coat: irregular dark rings and blotches over grey-brown.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */ `#include <common>
          varying vec3 vCoat;
          float coatHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
          float coatNoise(vec3 p) {
            vec3 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(coatHash(i), coatHash(i + vec3(1, 0, 0)), f.x), mix(coatHash(i + vec3(0, 1, 0)), coatHash(i + vec3(1, 1, 0)), f.x), f.y),
                       mix(mix(coatHash(i + vec3(0, 0, 1)), coatHash(i + vec3(1, 0, 1)), f.x), mix(coatHash(i + vec3(0, 1, 1)), coatHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
          }`)
        .replace('#include <color_fragment>', /* glsl */ `#include <color_fragment>
          if (diffuseColor.r > 0.05) {
            float n = coatNoise(vCoat * 1.6) * 0.65 + coatNoise(vCoat * 4.1) * 0.35;
            float blotch = smoothstep(0.6, 0.66, n) + 0.5 * (smoothstep(0.42, 0.45, n) - smoothstep(0.47, 0.5, n));
            diffuseColor.rgb *= mix(1.0, 0.42, clamp(blotch, 0.0, 1.0)) * (0.85 + 0.3 * coatNoise(vCoat * 0.5));
          }`);
    };
    this.sealMesh = new THREE.InstancedMesh(sealGeo, sealMat, SEALS);
    this.sealMesh.castShadow = true;
    this.sealMesh.receiveShadow = true;
    this.sealMesh.visible = false;
    this.disposables.push(sealGeo, sealMat);

    this.group.add(this.gullMesh, this.whale, this.sealMesh);
  }

  setSceneDepth(depth: THREE.Texture) {
    this.spray.uniforms.tDepth.value = depth;
  }

  /** Where the sea begins along this z (the first x past the beach below sea level), or null if it doesn't. */
  private shoreX(z: number) {
    const key = Math.round(z / 8);
    if (this.shoreCache.has(key)) return this.shoreCache.get(key)!;
    let found: number | null = null;
    for (let x = -100; x < 1400; x += 2) {
      if (this.fns.height(x, key * 8) < -0.3 && this.fns.river(x, key * 8) < 0.3) {
        found = x;
        break;
      }
    }
    this.shoreCache.set(key, found);
    return found;
  }

  /**
   * `time`: world seconds (for ripples); `light`: the sky's light on the spray (dims at dusk and night); `daylight`
   * 0..1.
   */
  update(time: number, dt: number, camera: THREE.PerspectiveCamera, daylight: number, light: THREE.Color, pixelsPerMeter: number) {
    this.time = time;
    const cam = camera.position;
    const shore = this.shoreX(cam.z);
    const fromShore = shore === null ? Infinity : Math.abs(cam.x - shore);
    this.updateGulls(dt, cam, shore, fromShore, daylight);
    this.updateWhale(dt, cam, fromShore);
    this.updateSeals(cam, fromShore);
    this.sealUniforms.uTime.value = time;
    const su = this.spray.uniforms;
    su.uNear.value = camera.near;
    su.uFar.value = camera.far;
    su.uPixelsPerMeter.value = pixelsPerMeter;
    su.uLight.value.copy(light);
    this.spray.update(dt);
  }

  // Gulls ----------------------------------------------------------------------------------------------------------

  private soarPos(g: Gull, out: THREE.Vector3) {
    return out.set(
      this.gullCenter.x + Math.cos(g.theta) * g.radius,
      g.alt + 2.5 * Math.sin(g.theta * 2 + g.seed),
      this.gullCenter.z + Math.sin(g.theta) * g.radius * 0.8,
    );
  }

  private updateGulls(dt: number, cam: THREE.Vector3, shore: number | null, fromShore: number, daylight: number) {
    const show = shore !== null && fromShore < 350 && daylight > 0.25;
    this.gullMesh.visible = show;
    if (!show || shore === null) return;
    // The flock works the shallows off the stretch of coast you're on.
    if (Math.hypot(this.gullCenter.x - cam.x, this.gullCenter.z - cam.z) > 220) {
      const z = cam.z + (Math.random() - 0.5) * 60;
      const sx = this.shoreX(z) ?? shore;
      this.gullCenter.set(sx + 25 + Math.random() * 35, 0, z);
      for (const g of this.gulls) {
        g.mode = 'soar';
        this.soarPos(g, g.pos);
        g.prev.copy(g.pos);
      }
    }
    const pose = this.gullMesh.geometry.getAttribute('aPose') as THREE.InstancedBufferAttribute;
    const tmp = this.v;
    this.gulls.forEach((g, i) => {
      g.theta += g.omega * dt;
      g.t += dt;
      g.prev.copy(g.pos);
      let flap = 0.12, fold = 0;
      const now = this.time;
      if (g.mode === 'soar') {
        this.soarPos(g, g.pos);
        // Mostly gliding, with a few wingbeats now and then.
        const flapping = THREE.MathUtils.smoothstep(Math.sin(now * 0.45 + g.seed * 7), 0.55, 0.85);
        flap = 0.14 + flapping * Math.sin(now * 8.5 + g.seed) * 0.6;
        g.nextDive -= dt;
        if (g.nextDive < 0 && this.fns.height(g.pos.x, g.pos.z) < -1) {
          // Fold and drop on a curve that steepens to the water a few meters ahead.
          const dir = tmp.subVectors(g.pos, g.prev).setY(0).normalize();
          g.mode = 'dive';
          g.t = 0;
          g.dur = 0.9 + g.pos.y * 0.035;
          g.p0.copy(g.pos);
          g.p1.copy(g.pos).addScaledVector(dir, 5);
          g.p2.copy(g.pos).addScaledVector(dir, 8).setY(0.05);
        }
      } else if (g.mode === 'dive') {
        const u = Math.min(g.t / g.dur, 1);
        bezier(g.p0, g.p1, g.p2, u * u, g.pos);
        fold = THREE.MathUtils.smoothstep(u, 0.05, 0.35);
        flap = 0.3;
        if (u >= 1) {
          this.splash(g.pos, 0.6);
          g.mode = 'sit';
          g.t = 0;
          g.dur = 1.2 + Math.random() * 2;
        }
      } else if (g.mode === 'sit') {
        g.pos.copy(g.p2).setY(0.06 + 0.05 * Math.sin(now * 2.2 + g.seed));
        fold = 1;
        if (g.t > g.dur) {
          // Labor back up, rejoining the circle where it will be when the climb ends.
          g.mode = 'rise';
          g.t = 0;
          g.dur = 2.6;
          g.p0.copy(g.pos);
          const back = { ...g, theta: g.theta + g.omega * g.dur } as Gull;
          this.soarPos(back, g.p2);
          g.p1.lerpVectors(g.p0, g.p2, 0.35).setY(g.p0.y + 2);
          this.spray.emit(g.pos, { count: 10, speed: [1, 2.5], dir: new THREE.Vector3(0, 1, 0), spread: 0.8, size: [0.08, 0.16], life: [0.4, 0.8], gravity: 9.8, drag: 0.5 });
        }
      } else {
        const u = Math.min(g.t / g.dur, 1);
        bezier(g.p0, g.p1, g.p2, 1 - (1 - u) * (1 - u), g.pos);
        flap = 0.2 + Math.sin(now * 11 + g.seed) * 0.75 * (1 - 0.5 * u);
        if (u >= 1) {
          g.mode = 'soar';
          g.nextDive = 15 + Math.random() * 35;
        }
      }
      pose.setXY(i, flap, fold);

      // Face along the flight, nose down in a dive, banking into turns.
      const d = tmp.subVectors(g.pos, g.prev);
      if (g.mode !== 'sit' && d.lengthSq() > 1e-8) {
        const yaw = Math.atan2(d.x, d.z);
        let dy = yaw - g.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        const rate = dt > 0 ? dy / dt : 0;
        g.roll += (THREE.MathUtils.clamp(-rate * 0.6, -0.7, 0.7) - g.roll) * Math.min(dt * 3, 1);
        g.yaw = yaw;
        const pitch = -Math.atan2(d.y, Math.hypot(d.x, d.z));
        this.e.set(g.mode === 'dive' ? pitch : pitch * 0.5, g.yaw, g.roll);
      } else this.e.set(0, g.yaw, 0);
      this.q.setFromEuler(this.e);
      this.gullMesh.setMatrixAt(i, this.m.compose(g.pos, this.q, this.one));
    });
    pose.needsUpdate = true;
    this.gullMesh.instanceMatrix.needsUpdate = true;
  }

  /** A splash where something hits the water: droplets thrown up and a ring on the surface. */
  private splash(at: THREE.Vector3, size: number) {
    this.spray.emit(at, {
      count: Math.round(14 + 140 * size * size), speed: [1.5 * size + 1, 5 * size + 2], dir: new THREE.Vector3(0, 1, 0), spread: 0.55,
      size: [0.1 + 0.4 * size, 0.25 + 1.0 * size], life: [0.7, 1.2 + size], gravity: 9.8, drag: 0.4, radius: 0.3 + size * 2,
    });
    addRipple(at.x, at.z, this.time, Math.min(0.5 + size, 3));
  }

  // Whale ----------------------------------------------------------------------------------------------------------

  /** Starts a whale surfacing (or breaching) offshore in view of the coast near the camera. */
  surfaceWhale(camera: THREE.Vector3, kind: WhaleKind = Math.random() < 0.25 ? 'breach' : 'blow') {
    const z = camera.z + (Math.random() - 0.5) * 300;
    const sx = this.shoreX(z);
    if (sx === null) return false;
    let x = Math.max(sx + 120 + Math.random() * 200, camera.x + 120);
    for (let k = 0; k < 10 && this.fns.height(x, z) > -10; k++) x += 60;
    // Heading out to sea on a slant: the back rolls by side-on enough, and the flukes rise nearly face-on.
    const a = (0.45 + Math.random() * 0.45) * (Math.random() < 0.5 ? 1 : -1);
    const heading = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    this.whaleState = { kind, t: 0, origin: new THREE.Vector3(x, 0, z), heading, blows: new Set() };
    return true;
  }

  private updateWhale(dt: number, cam: THREE.Vector3, fromShore: number) {
    if (!this.whaleState) {
      this.whale.visible = false;
      this.nextWhale -= dt;
      if (this.nextWhale < 0 && fromShore < 500) {
        this.surfaceWhale(cam);
        this.nextWhale = 40 + Math.random() * 50;
      }
      return;
    }
    const s = this.whaleState;
    s.t += dt;
    const t = s.t;
    let y: number, pitch: number, arch = 0, roll = 0, along: number;
    let done = false;
    if (s.kind === 'blow') {
      // Three breaths, each rolling the back up through the swell (blowing as the blowhole clears), then the dive.
      along = 2.2 * t;
      const breaths = [0, 6.5, 13];
      const diveAt = 19.5;
      y = -12;
      pitch = 0;
      for (const [b, start] of breaths.entries()) {
        const u = (t - start) / 5.5;
        if (u >= 0 && u <= 1) {
          y = -2.9 + 2.3 * Math.sin(Math.PI * u);
          pitch = -0.28 * Math.cos(Math.PI * u);
          arch = -0.08 * Math.cos(Math.PI * u);
          if (u > 0.22 && !s.blows.has(b)) {
            s.blows.add(b);
            this.blow();
          }
        }
      }
      if (t > diveAt) {
        const u = (t - diveAt) / 8;
        if (u < 0.35) {
          const w = u / 0.35;
          y = -2.9 + 2.3 * Math.sin((Math.PI / 2) * w);
          pitch = -0.28 + 0.4 * w;
          if (w > 0.4 && !s.blows.has(9)) {
            s.blows.add(9);
            this.blow();
          }
        } else {
          // Rounding down: the back arches, the body tips steeply nose down, the flukes lift clear and slide under.
          const w = (u - 0.35) / 0.65;
          pitch = 0.12 + 0.95 * THREE.MathUtils.smoothstep(w, 0, 0.6);
          arch = 0.55 * THREE.MathUtils.smoothstep(w, 0.1, 0.55);
          y = -0.6 - 4.5 * THREE.MathUtils.smoothstep(w, 0.05, 0.6) - 9 * THREE.MathUtils.smoothstep(w, 0.6, 1);
          along = 2.2 * diveAt + 2.2 * (t - diveAt) * (1 - 0.6 * w);
        }
        if (u >= 1) done = true;
      }
    } else {
      // A breach: driven up from the deep at a steep angle, most of the body clearing the water, twisting onto its
      // side at the top and crashing back.
      const vy = 17.5, g = 9.8;
      y = -14 + vy * t - 0.5 * g * t * t;
      along = 3.5 * t;
      pitch = -1.05 * (1 - THREE.MathUtils.smoothstep(t, 1.2, 3.3)) + 0.35 * THREE.MathUtils.smoothstep(t, 2.8, 4.2);
      roll = 1.5 * THREE.MathUtils.smoothstep(t, 1.0, 2.8);
      arch = -0.15 * THREE.MathUtils.smoothstep(t, 1.4, 2.6);
      const prevY = -14 + vy * (t - dt) - 0.5 * g * (t - dt) * (t - dt);
      const pos = this.v.copy(s.origin).addScaledVector(s.heading, along).setY(0);
      if (prevY < 0 && y >= 0) this.splash(pos, 1.6);
      if (prevY > -1 && y <= -1) {
        this.splash(pos, 3.2);
        this.splash(pos.clone().addScaledVector(s.heading, 3), 2.2);
      }
      if (t > 9) done = true;
    }
    if (done) {
      this.whaleState = null;
      this.whale.visible = false;
      return;
    }
    this.whale.visible = true;
    this.whale.position.copy(s.origin).addScaledVector(s.heading, along).setY(y);
    this.e.set(pitch, Math.atan2(s.heading.x, s.heading.z), roll);
    this.whale.quaternion.setFromEuler(this.e);
    // (Positive arch lifts the tail: the rear half turns about x, and its far end is at -z.)
    this.whaleRear.rotation.x = arch;
    this.whale.updateMatrixWorld(true);
    // Water streaming off the flukes as they rise.
    const tip = this.v.set(0, 0, -6.9).applyMatrix4(this.whaleRear.matrixWorld);
    if (tip.y > 0.4 && Math.random() < 0.9) {
      for (const sx of [-1.6, -0.6, 0.6, 1.6]) {
        const p = new THREE.Vector3(sx, 0, -7.4).applyMatrix4(this.whaleRear.matrixWorld);
        this.spray.emit(p, { count: 1, speed: [0, 0.5], dir: new THREE.Vector3(0, -1, 0), spread: 0.3, size: [0.15, 0.35], life: [0.8, 1.2], gravity: 9.8, drag: 0.2 });
      }
    }
  }

  /** The blow: a column of mist from the blowhole, drifting downwind as it hangs and fades. */
  private blow() {
    const hole = this.v.set(0, 1.25, 4.3).applyMatrix4(this.whale.matrixWorld);
    // Speeds spread from slow to fast so the drops string out into one column, widening into a bushy head.
    this.spray.emit(hole, { count: 160, speed: [2, 13], dir: new THREE.Vector3(0, 1, 0), spread: 0.1, size: [0.35, 0.9], life: [2.5, 4.5], gravity: 0.8, drag: 1.3, windDrift: 1.5 });
    this.spray.emit(hole, { count: 60, speed: [8, 12], dir: new THREE.Vector3(0, 1, 0), spread: 0.3, size: [0.8, 1.5], life: [2.5, 4], gravity: 0.5, drag: 1.5, windDrift: 1.5 });
  }

  // Seals ----------------------------------------------------------------------------------------------------------

  private updateSeals(cam: THREE.Vector3, fromShore: number) {
    const show = fromShore < 400;
    this.sealMesh.visible = show && this.sealMesh.count > 0;
    if (!show || Math.hypot(this.sealCenter.x - cam.x, this.sealCenter.z - cam.z) < 260) return;
    // Haul-outs: two colonies at the water's edge along the coast near you, on gentle wet sand.
    this.sealCenter.copy(cam);
    let n = 0;
    for (let colony = 0; colony < 2 && n < SEALS; colony++) {
      for (let attempt = 0; attempt < 12; attempt++) {
        const z = cam.z + (Math.random() - 0.5) * 260;
        const sx = this.shoreX(z);
        if (sx === null) continue;
        // Back up the beach from the sea to just above the waterline.
        let x = sx;
        while (x > sx - 40 && this.fns.height(x, z) < 0.35) x -= 0.5;
        const count = 3 + Math.floor(Math.random() * 3);
        for (let k = 0; k < count && n < SEALS; k++) {
          const px = x - Math.random() * 4, pz = z + (Math.random() - 0.5) * 9;
          const h = this.fns.height(px, pz);
          const slope = Math.abs(this.fns.height(px + 1, pz) - this.fns.height(px - 1, pz));
          if (h < 0.25 || h > 1.6 || slope > 0.5) continue;
          // Mostly facing the sea.
          const yaw = Math.PI / 2 + (Math.random() - 0.5) * 2.2;
          this.e.set(0, yaw, 0);
          this.q.setFromEuler(this.e);
          const s = 0.85 + Math.random() * 0.35;
          this.sealMesh.setMatrixAt(n++, this.m.compose(new THREE.Vector3(px, h - 0.04, pz), this.q, new THREE.Vector3(s, s, s)));
        }
        break;
      }
    }
    this.sealMesh.count = n;
    this.sealMesh.instanceMatrix.needsUpdate = true;
    this.sealMesh.computeBoundingSphere();
  }

  /** Positions of the seals and the whale, for screenshots and tests. */
  get debug() {
    const seals: THREE.Vector3[] = [];
    for (let i = 0; i < this.sealMesh.count; i++) {
      this.sealMesh.getMatrixAt(i, this.m);
      seals.push(new THREE.Vector3().setFromMatrixPosition(this.m));
    }
    return { seals, whale: this.whaleState ? this.whale.position.clone() : null, gulls: this.gulls.map((g) => g.pos.clone()), gullCenter: this.gullCenter.clone() };
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.gullMesh.dispose();
    this.sealMesh.dispose();
    this.spray.dispose();
    this.overlay.removeFromParent();
  }
}

function bezier(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, u: number, out: THREE.Vector3) {
  const v = 1 - u;
  return out.set(
    v * v * a.x + 2 * v * u * b.x + u * u * c.x,
    v * v * a.y + 2 * v * u * b.y + u * u * c.y,
    v * v * a.z + 2 * v * u * b.z + u * u * c.z,
  );
}
