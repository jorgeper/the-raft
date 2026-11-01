import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { TERRAIN_SIZE } from './terrain';
import type { WorldFns } from './worldgen';
import type { ScannedRock } from './scanned-rocks';
import { createFracturedRocks } from './fractured-rocks';

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RockPlacement {
  shape: number;
  matrix: THREE.Matrix4;
  color: THREE.Color;
  center: THREE.Vector3;
  size: number;
}

/**
 * Scanned rocks drawn with two detail levels: full detail close up, the light mesh further out, and small rocks
 * culled entirely past a distance that grows with their size.
 */
class ScannedRockField {
  readonly group = new THREE.Group();
  private meshes: [THREE.InstancedMesh, THREE.InstancedMesh][];
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private sphere = new THREE.Sphere();

  constructor(private shapes: ScannedRock[], private placements: RockPlacement[]) {
    const counts = shapes.map((_, i) => Math.max(placements.filter((pl) => pl.shape === i).length, 1));
    this.meshes = shapes.map((shape, i) => {
      const pair = [
        new THREE.InstancedMesh(shape.lod0, shape.material, counts[i]),
        new THREE.InstancedMesh(shape.lod1, shape.material, counts[i]),
      ] as [THREE.InstancedMesh, THREE.InstancedMesh];
      for (const mesh of pair) {
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = mesh.receiveShadow = true;
        this.group.add(mesh);
      }
      return pair;
    });
  }

  update(camera: THREE.Camera) {
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    for (const pair of this.meshes) pair[0].count = pair[1].count = 0;
    for (const pl of this.placements) {
      const d = pl.center.distanceTo(camera.position);
      if (d > 120 + pl.size * 90) continue;
      this.sphere.center.copy(pl.center);
      this.sphere.radius = pl.size + 20; // padding keeps nearby shadow casters
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const mesh = this.meshes[pl.shape][d < 18 + pl.size * 10 ? 0 : 1];
      mesh.setMatrixAt(mesh.count, pl.matrix);
      mesh.setColorAt(mesh.count, pl.color);
      mesh.count++;
    }
    for (const mesh of this.meshes.flat()) {
      if (mesh.count === 0) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.clearUpdateRanges();
      mesh.instanceColor!.addUpdateRange(0, mesh.count * 3);
      mesh.instanceColor!.needsUpdate = true;
    }
  }
}

export interface Rocks {
  group: THREE.Group;
  /** Every placed rock, with its shape's name (for finding shots and debugging). */
  placements: (RockPlacement & { name: string })[];
  /** Per-frame detail and culling. */
  update(camera: THREE.Camera): void;
}

/**
 * Boulders, outcrops and pebbles from the photoscanned rocks (when fetched) plus procedural fractured ones, and a
 * ring of fractured standing stones.
 */
export function createRocks(world: WorldFns, scanned: ScannedRock[] = []): Rocks {
  const { height, params } = world;
  const rand = mulberry32(params.seed * 13 + 7331);
  const noise = createNoise2D(rand);
  const group = new THREE.Group();
  const fractured = createFracturedRocks(params.seed);
  const shapes = [...scanned, ...fractured.field];
  // Instance tints: plain stone, warm lichen-yellow, cool grey and dark wet stone.
  const tints = ['#ffffff', '#ffffff', '#f0e8d0', '#dde2e8', '#cfccc6'].map((c) => new THREE.Color(c));

  const placements: RockPlacement[] = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const place = (shape: number, x: number, z: number, size: number, sink: number, tilt = 0.25) => {
    e.set((rand() - 0.5) * tilt, rand() * Math.PI * 2, (rand() - 0.5) * tilt);
    q.setFromEuler(e);
    s.set(size * (0.8 + rand() * 0.4), size * (0.8 + rand() * 0.4), size * (0.8 + rand() * 0.4));
    // Every shape has its base at y = 0; tall ones sink deeper.
    const y = height(x, z) - sink * size * (0.35 * shapes[shape].aspect + 0.05);
    const m = new THREE.Matrix4().compose(p.set(x, y, z), q, s);
    const color = tints[Math.floor(rand() * tints.length)];
    // Landmarks keep their ground clear; skipped after the draws so every other rock stays put.
    if (world.clearing(x, z) > 0.5) return;
    placements.push({ shape, matrix: m, color, size, center: new THREE.Vector3(x, y + size * 0.4, z) });
  };
  const pickShape = () => Math.floor(rand() * shapes.length);
  /** Outcrop cores lean on the fractured crags and blocks: big broken faces read best at that size. */
  const pickCore = () => (rand() < 0.6 ? scanned.length + Math.floor(rand() * fractured.field.length) : pickShape());

  // Scattered boulders: clustered by noise, more on hills and along the beach.
  const half = TERRAIN_SIZE / 2 - 30;
  for (let i = 0; i < 9000 * params.rocks; i++) {
    const x = (rand() * 2 - 1) * half, z = (rand() * 2 - 1) * half;
    const h = height(x, z);
    if (h < -0.5 || world.pondEdge(x, z) < 1) continue;
    const cluster = THREE.MathUtils.smoothstep(noise(x * 0.006, z * 0.006), 0.3, 0.8);
    const beach = h < 3 ? 0.35 : 0;
    // Forest floors are strewn with mossy boulders.
    const forest = world.forest(x, z) * 0.35;
    if (rand() > cluster * 0.5 + beach + forest + 0.02) continue;
    const big = rand() < 0.12;
    const size = big ? 2.5 + rand() * 3 : 0.4 + rand() * 1.2;
    place(pickShape(), x, z, size, big ? 0.3 : 0.2);
  }

  // Outcrops: a large rock half-buried with smaller ones piled against it, mostly on hills and in forests.
  for (let i = 0; i < 260 * params.rocks; i++) {
    const x = (rand() * 2 - 1) * half, z = (rand() * 2 - 1) * half;
    const h = height(x, z);
    if (h < 4) continue;
    const slope = Math.hypot(height(x + 2, z) - h, height(x, z + 2) - h) / 2;
    if (rand() > 0.25 + slope * 1.5 + world.forest(x, z) * 0.4) continue;
    const size = 4 + rand() * 5;
    place(pickCore(), x, z, size, 0.35, 0.4);
    const n = 2 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2, d = size * (0.45 + rand() * 0.4);
      place(pickShape(), x + Math.cos(a) * d, z + Math.sin(a) * d, size * (0.25 + rand() * 0.35), 0.25, 0.6);
    }
  }

  // River shores: boulders along the water's edge (some standing in the shallows), stones strewn over the gravel
  // shelf, and blocks fallen from the ledges onto the bank face.
  for (let i = 0; i < 150000 * params.rocks; i++) {
    const x = (rand() * 2 - 1) * half, z = (rand() * 2 - 1) * half;
    const edge = world.riverEdge(x, z);
    if (edge < -3 || edge > 30) continue;
    const h = height(x, z);
    const clump = 0.5 + 0.5 * noise(x * 0.05 + 40, z * 0.05);
    if (edge < 8) {
      // Waterline and shelf.
      if (rand() > 0.6 * clump + 0.1) continue;
      const big = rand() < 0.18;
      place(pickShape(), x, z, big ? 1.2 + rand() * 1.8 : 0.25 + rand() * 0.7, 0.25, 0.5);
    } else {
      // Bank face: blocks lodged on the steeper ground.
      const slope = Math.hypot(height(x + 2, z) - h, height(x, z + 2) - h) / 2;
      if (rand() > (0.04 + 0.25 * THREE.MathUtils.smoothstep(slope, 0.25, 0.8)) * clump) continue;
      place(rand() < 0.4 ? pickCore() : pickShape(), x, z, 0.8 + rand() * 2.6, 0.35, 0.5);
    }
  }

  // Ponds: mossy boulders around the rim (a few half-sunk in the shallows), in clumps with open stretches between.
  for (const pond of world.ponds) {
    const n = Math.round(pond.radius * 2.2);
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2;
      // Walk out from the center to the waterline, then a little past or short of it.
      let r = pond.radius * 0.5;
      while (r < pond.radius * 2 && world.pondEdge(pond.x + Math.cos(a) * r, pond.z + Math.sin(a) * r) < 0) r += 0.25;
      r += -0.6 + rand() * 2.6;
      const x = pond.x + Math.cos(a) * r, z = pond.z + Math.sin(a) * r;
      if (noise(x * 0.15 + 3, z * 0.15) < -0.25) continue;
      const big = rand() < 0.3;
      place(pickShape(), x, z, big ? 0.9 + rand() * 1.1 : 0.25 + rand() * 0.5, 0.3, 0.5);
    }
  }

  // Pebbles scattered everywhere on land, denser where boulders cluster.
  for (let i = 0; i < 14000 * params.rocks; i++) {
    const x = (rand() * 2 - 1) * half, z = (rand() * 2 - 1) * half;
    const h = height(x, z);
    if (h < 0.3 || world.pondEdge(x, z) < 0) continue;
    const cluster = THREE.MathUtils.smoothstep(noise(x * 0.006, z * 0.006), 0.1, 0.7);
    if (rand() > 0.3 + cluster * 0.7) continue;
    place(pickShape(), x, z, 0.12 + rand() * 0.3, 0.25, 0.6);
  }

  // Rings of standing stones (worldgen's circles: the first on the bluff above the beach, near the start view).
  const ring: THREE.Matrix4[][] = fractured.standing.map(() => []);
  for (const circle of world.landmarks) {
    if (circle.kind !== 'circle') continue;
    const { x: cx, z: cz, radius } = circle;
    const count = Math.round(radius);
    for (let i = 0; i < count; i++) {
      if (i === 4) continue; // one fallen gap
      const a = (i / count) * Math.PI * 2 + rand() * 0.2;
      const x = cx + Math.cos(a) * radius, z = cz + Math.sin(a) * radius;
      // Broad face toward the ring's center.
      e.set((rand() - 0.5) * 0.12, Math.PI / 2 - a, (rand() - 0.5) * 0.12);
      q.setFromEuler(e);
      const size = 1.3 + rand() * 0.5;
      s.set(size, size, size);
      ring[i % 2].push(new THREE.Matrix4().compose(p.set(x, height(x, z) - 0.3, z), q, s));
    }
  }
  fractured.standing.forEach((stone, i) => {
    const mesh = new THREE.InstancedMesh(stone.lod0, stone.material, ring[i].length);
    ring[i].forEach((m, k) => mesh.setMatrixAt(k, m));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });

  const field = new ScannedRockField(shapes, placements);
  group.add(field.group);
  return {
    group,
    placements: placements.map((pl) => ({ ...pl, name: shapes[pl.shape].name })),
    update: (camera) => field.update(camera),
  };
}
