import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { WorldFns } from './worldgen';

/**
 * Red deer at the forest edges: small herds (a stag with a few does) that graze, lift their heads to look around,
 * wander a few steps, and bolt into the trees when the player comes close.
 *
 * The models (`public/models/deer.glb`, modeled for this project in Blender from metaballs, vertex-painted) have
 * no skeleton. The vertex shader poses them from a per-instance `aAnim`: legs swing about the hips in a walk or
 * gallop, the neck lowers the head to graze. Shadows use the same pose.
 * In the model the deer faces -Z, hooves at y = 0, about 1.1 m at the shoulder.
 */

const POSE = /* glsl */ `
  attribute vec4 aAnim; // x: gait phase (radians), y: stride (0 still, 1 walk, 2 gallop), z: head down (0-1), w: ear/tail flick
  // Rotation about the X axis through a pivot (y, z), applied to a point and a normal.
  vec3 rotX(vec3 p, float a, vec2 pivot) {
    vec2 q = p.yz - pivot;
    float c = cos(a), s = sin(a);
    return vec3(p.x, vec2(q.x * c - q.y * s, q.x * s + q.y * c) + pivot);
  }
  vec3 rotXn(vec3 n, float a) {
    float c = cos(a), s = sin(a);
    return vec3(n.x, n.y * c - n.z * s, n.y * s + n.z * c);
  }
  // The pose for a vertex of the rest model: returns the moved position; rotates the normal in place.
  vec3 deerPose(vec3 p, inout vec3 n) {
    float stride = aAnim.y;
    // Legs: columns under the hips (front at z = -0.45, hind at z = 0.55), swinging from y = 0.85.
    bool front = p.z < 0.05;
    float zLeg = front ? -0.45 : 0.55;
    float legW = smoothstep(0.88, 0.62, p.y) * smoothstep(0.03, 0.07, abs(p.x)) * (1.0 - smoothstep(0.16, 0.26, abs(p.z - zLeg)));
    // Diagonal pairs move together (a trot; at gallop speed it reads well enough from afar).
    float legPhase = aAnim.x + ((p.x > 0.0) == front ? 0.0 : 3.14159);
    float swing = sin(legPhase) * min(stride, 1.0) * 0.42 + sin(legPhase) * max(stride - 1.0, 0.0) * 0.35;
    float a = swing * legW;
    // Lift the lower leg on the forward swing, so hooves clear the ground.
    float lift = max(cos(legPhase), 0.0) * min(stride, 1.5) * 0.08 * smoothstep(0.6, 0.1, p.y) * legW;
    vec3 q = rotX(p, a, vec2(0.85, zLeg));
    q.y += lift;
    n = rotXn(n, a);
    // Neck and head: lowered toward the grass about the base of the neck.
    float headW = smoothstep(-0.42, -0.62, p.z) * smoothstep(0.92, 1.12, p.y);
    float h = -aAnim.z * 1.25 * headW;
    // A small nod in step while walking, a flick of the ears/head when alert.
    h += sin(aAnim.x * 2.0) * 0.05 * min(stride, 1.0) * headW + aAnim.w * 0.08 * smoothstep(1.5, 1.75, p.y);
    q = rotX(q, h, vec2(0.95, -0.45));
    n = rotXn(n, h);
    // The body rises and falls a little with the gait.
    q.y += abs(sin(aAnim.x)) * 0.03 * stride;
    return q;
  }
`;

function poseMaterial(material: THREE.Material, depth: boolean) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${POSE}`);
    if (depth) {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 unusedN = vec3(0.0, 1.0, 0.0);
        transformed = deerPose(transformed, unusedN);`,
      );
    } else {
      // Normals are posed first (three computes them before positions), then the same pose moves the vertex.
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
          vec3 posedP = deerPose(position, objectNormal);`,
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed = posedP;');
      // A soft sheen on the coat's rim, like fur catching the light.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float deerRim = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * deerRim * 0.25;`,
      );
    }
  };
  material.customProgramCacheKey = () => (depth ? 'deer-depth' : 'deer');
}

/**
 * Touch-ups to the exported model: smaller ears (they read as mouse ears from the side), a darker muzzle (the pale
 * chin read as a ball on the nose), and a slightly lighter coat.
 */
function refine(geometry: THREE.BufferGeometry) {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const col = geometry.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
    // Ears: coat-colored (reddish, unlike the beige antlers) parts beside and above the head.
    if (Math.abs(x) > 0.06 && Math.abs(x) < 0.3 && y > 1.6 && y < 1.9 && z > -0.98 && z < -0.62 && r > b * 1.45) {
      const k = 0.7, sx = Math.sign(x);
      pos.setXYZ(i, sx * 0.06 + (x - sx * 0.06) * k, 1.66 + (y - 1.66) * k, -0.81 + (z + 0.81) * k);
    }
    let c = 1.15;
    if (z < -1.0) c *= THREE.MathUtils.lerp(1, 0.55, THREE.MathUtils.smoothstep(-z, 1.0, 1.1));
    col.setXYZ(i, r * c, g * c, b * c);
  }
  geometry.computeVertexNormals();
}

type State = 'graze' | 'look' | 'walk' | 'flee';

interface Deer {
  stag: boolean;
  index: number;
  pos: THREE.Vector3;
  heading: number;
  target: THREE.Vector2;
  state: State;
  timer: number;
  phase: number;
  stride: number;
  head: number;
  flick: number;
  scale: number;
}

const HERDS = 4;
const SPAWN_MIN = 45, SPAWN_MAX = 140;
/** The player startles a deer inside this distance; it runs until well out of reach. */
const STARTLE = 26;

export class DeerHerds {
  readonly group = new THREE.Group();
  private deer: Deer[] = [];
  private meshes: { doe?: THREE.InstancedMesh; stag?: THREE.InstancedMesh } = {};
  private anim: { doe?: THREE.InstancedBufferAttribute; stag?: THREE.InstancedBufferAttribute } = {};
  private materials: THREE.Material[] = [];
  private rand = Math.random;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private lastTime = 0;

  constructor(private world: WorldFns) {
    new GLTFLoader().load(`${import.meta.env.BASE_URL}models/deer.glb`, (gltf) => this.build(gltf.scene));
  }

  private build(scene: THREE.Object3D) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    poseMaterial(material, false);
    const depth = new THREE.MeshDepthMaterial();
    poseMaterial(depth, true);
    this.materials.push(material, depth);
    for (const name of ['Doe', 'Stag'] as const) {
      const src = scene.getObjectByName(name) as THREE.Mesh | undefined;
      if (!src) continue;
      const geometry = src.geometry;
      refine(geometry);
      const count = name === 'Stag' ? HERDS : HERDS * 3;
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      const anim = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
      anim.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute('aAnim', anim);
      mesh.customDepthMaterial = depth;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
      if (name === 'Stag') (this.meshes.stag = mesh), (this.anim.stag = anim);
      else (this.meshes.doe = mesh), (this.anim.doe = anim);
    }
  }

  /** A spot at the forest edge, on gentle dry ground, in a ring around the viewer. */
  private findSpot(center: THREE.Vector3, out: THREE.Vector3, minR = SPAWN_MIN, maxR = SPAWN_MAX) {
    const w = this.world;
    for (let i = 0; i < 120; i++) {
      const a = this.rand() * Math.PI * 2, r = minR + this.rand() * (maxR - minR);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const f = w.forest(x, z), h = w.height(x, z);
      if (h < 2.5 || f < 0.04 || f > 0.6 || w.river(x, z) > 0.2) continue;
      const slope = Math.abs(w.height(x + 2, z) - w.height(x - 2, z)) + Math.abs(w.height(x, z + 2) - w.height(x, z - 2));
      if (slope > 1.6) continue;
      return out.set(x, h, z);
    }
    return null;
  }

  private spawnHerd(center: THREE.Vector3) {
    const spot = this.findSpot(center, new THREE.Vector3());
    if (!spot) return;
    const does = 1 + Math.floor(this.rand() * 3);
    const withStag = this.rand() < 0.6;
    const members = (withStag ? 1 : 0) + does;
    for (let k = 0; k < members; k++) {
      const stag = withStag && k === 0;
      const pos = spot.clone().add(new THREE.Vector3((this.rand() - 0.5) * 8, 0, (this.rand() - 0.5) * 8));
      pos.y = this.world.height(pos.x, pos.z);
      this.deer.push({
        stag,
        index: 0,
        pos,
        heading: this.rand() * Math.PI * 2,
        target: new THREE.Vector2(pos.x, pos.z),
        state: 'graze',
        timer: 2 + this.rand() * 6,
        phase: this.rand() * 6,
        stride: 0,
        head: 1,
        flick: 0,
        scale: stag ? 1.12 + this.rand() * 0.08 : 0.92 + this.rand() * 0.1,
      });
    }
  }

  update(time: number, viewer: THREE.Vector3) {
    const dt = Math.min(time - this.lastTime, 0.1);
    this.lastTime = time;
    if (!this.meshes.doe || !this.meshes.stag) return;
    // Herds out of sight and mind are dropped; new ones appear beyond view range.
    this.deer = this.deer.filter((d) => d.pos.distanceTo(viewer) < 260);
    const herdsNow = Math.ceil(this.deer.length / 3);
    if (herdsNow < HERDS && this.rand() < 0.02) this.spawnHerd(viewer);
    if (this.deer.length === 0) for (let i = 0; i < HERDS; i++) this.spawnHerd(viewer);

    for (const d of this.deer) this.think(d, dt, viewer);
    this.write();
  }

  private think(d: Deer, dt: number, viewer: THREE.Vector3) {
    const dist = Math.hypot(d.pos.x - viewer.x, d.pos.z - viewer.z);
    if (dist < STARTLE && d.state !== 'flee') {
      d.state = 'flee';
      // Away from the player, toward the denser forest if there's a choice.
      const away = Math.atan2(d.pos.z - viewer.z, d.pos.x - viewer.x);
      let best = away, bestForest = -1;
      for (const off of [-0.6, 0, 0.6]) {
        const a = away + off, x = d.pos.x + Math.cos(a) * 30, z = d.pos.z + Math.sin(a) * 30;
        const f = this.world.forest(x, z);
        if (f > bestForest) (bestForest = f), (best = a);
      }
      d.target.set(d.pos.x + Math.cos(best) * 90, d.pos.z + Math.sin(best) * 90);
      d.timer = 12;
    }
    d.timer -= dt;
    let speed = 0, headGoal = 0, strideGoal = 0;
    switch (d.state) {
      case 'graze':
        headGoal = 1;
        if (d.timer < 0) {
          d.state = this.rand() < 0.55 ? 'look' : 'walk';
          d.timer = 2 + this.rand() * 4;
          if (d.state === 'walk') {
            const a = this.rand() * Math.PI * 2, r = 3 + this.rand() * 8;
            d.target.set(d.pos.x + Math.cos(a) * r, d.pos.z + Math.sin(a) * r);
          }
        }
        break;
      case 'look':
        headGoal = 0;
        // Ears and head twitch now and then.
        d.flick = Math.max(d.flick - dt * 3, 0);
        if (this.rand() < dt * 0.8) d.flick = 1;
        if (d.timer < 0) (d.state = 'graze'), (d.timer = 4 + this.rand() * 8);
        break;
      case 'walk':
        speed = 1.1;
        strideGoal = 1;
        headGoal = 0.15;
        if (d.timer < 0 || Math.hypot(d.target.x - d.pos.x, d.target.y - d.pos.z) < 0.5) (d.state = 'graze'), (d.timer = 4 + this.rand() * 8);
        break;
      case 'flee':
        speed = 9;
        strideGoal = 2;
        headGoal = 0;
        if (d.timer < 0 || Math.hypot(d.target.x - d.pos.x, d.target.y - d.pos.z) < 2) {
          d.state = 'look';
          d.timer = 3;
        }
        break;
    }
    if (speed > 0) {
      const want = Math.atan2(d.target.y - d.pos.z, d.target.x - d.pos.x);
      let diff = want - d.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      d.heading += THREE.MathUtils.clamp(diff, -dt * 3, dt * 3);
      const nx = d.pos.x + Math.cos(d.heading) * speed * dt, nz = d.pos.z + Math.sin(d.heading) * speed * dt;
      // Deer stay out of the water.
      if (this.world.height(nx, nz) > 1) (d.pos.x = nx), (d.pos.z = nz);
      else d.target.set(d.pos.x - (nx - d.pos.x) * 40, d.pos.z - (nz - d.pos.z) * 40);
      d.pos.y = this.world.height(d.pos.x, d.pos.z);
    }
    const ease = 1 - Math.exp(-dt * 3);
    d.head += (headGoal - d.head) * ease;
    d.stride += (strideGoal - d.stride) * (1 - Math.exp(-dt * 4));
    // The gait cycle runs at a rate fitted to the speed: ~1.6 steps/s walking, ~2.4 galloping.
    d.phase += dt * (d.stride > 1 ? 15 : 10) * Math.min(Math.max(d.stride, 0.0), 1.0);
  }

  private write() {
    const meshes = this.meshes as Required<typeof this.meshes>, anims = this.anim as Required<typeof this.anim>;
    meshes.doe.count = meshes.stag.count = 0;
    const p = new THREE.Vector3();
    for (const d of this.deer) {
      const mesh = d.stag ? meshes.stag : meshes.doe, anim = d.stag ? anims.stag : anims.doe;
      if (mesh.count >= mesh.instanceMatrix.count) continue;
      const i = mesh.count++;
      // The model faces -Z; heading 0 is +X.
      this.q.setFromAxisAngle(this.up, -d.heading - Math.PI / 2);
      p.copy(d.pos);
      // Sink the hooves a touch so they don't float over grass-covered slopes.
      p.y -= 0.04;
      mesh.setMatrixAt(i, this.m.compose(p, this.q, this.s.setScalar(d.scale)));
      anim.setXYZW(i, d.phase, d.stride, d.head, d.flick);
    }
    for (const key of ['doe', 'stag'] as const) {
      meshes[key].instanceMatrix.needsUpdate = true;
      anims[key].needsUpdate = true;
    }
  }

  dispose() {
    for (const mesh of [this.meshes.doe, this.meshes.stag]) mesh?.geometry.dispose();
    for (const m of this.materials) m.dispose();
  }
}
