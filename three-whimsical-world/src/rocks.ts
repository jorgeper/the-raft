import * as THREE from 'three';
import { createNoise2D, createNoise3D } from 'simplex-noise';
import { TERRAIN_SIZE } from './terrain';
import type { WorldFns } from './worldgen';
import type { ScannedRock } from './scanned-rocks';

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A lumpy boulder about 1 unit across: noise-displaced sphere, flattened underneath, mossy on top. */
function createRockGeometry(seed: number, stretch: THREE.Vector3, detail = 5) {
  const noise = createNoise3D(mulberry32(seed));
  const geo = new THREE.IcosahedronGeometry(0.5, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const dir = v.clone().normalize();
    // Large lumps, then sharper facets for a fractured-stone look.
    let r = 1 + 0.28 * noise(dir.x * 1.2, dir.y * 1.2, dir.z * 1.2);
    r += 0.1 * noise(dir.x * 3.5, dir.y * 3.5, dir.z * 3.5);
    r -= 0.06 * Math.abs(noise(dir.x * 8, dir.y * 8, dir.z * 8));
    v.multiplyScalar(r).multiply(stretch);
    if (v.y < -0.15) v.y = -0.15 + (v.y + 0.15) * 0.3;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();

  const normals = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const stone = new THREE.Color('#9a958a'), dark = new THREE.Color('#625d55'), moss = new THREE.Color('#56692a');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const grain = 0.5 + 0.5 * noise(v.x * 6, v.y * 6, v.z * 6);
    c.copy(dark).lerp(stone, grain);
    // Moss collects on upward faces, broken up by noise.
    const up = normals.getY(i);
    const mossAmt = THREE.MathUtils.smoothstep(up + 0.3 * noise(v.x * 3 + 9, v.y * 3, v.z * 3), 0.45, 0.8);
    c.lerp(moss, mossAmt * 0.85);
    // Darker near the ground line.
    c.multiplyScalar(0.55 + 0.45 * THREE.MathUtils.smoothstep(v.y, -0.2, 0.15));
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
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
  /** Per-frame detail/culling; a no-op for procedural rocks. */
  update(camera: THREE.Camera): void;
}

/** Uses photoscanned rocks when `scanned` is non-empty, procedural ones otherwise. Standing stones stay procedural. */
export function createRocks(world: WorldFns, scanned: ScannedRock[] = []): Rocks {
  const { height, params } = world;
  const rand = mulberry32(params.seed * 13 + 7331);
  const noise = createNoise2D(rand);
  const material = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.9, specularIntensity: 0.3 });
  const group = new THREE.Group();

  // Shapes: round boulders, flat slabs, tall angular rocks, and a squat lumpy one.
  const boulders = [
    ...[0, 1, 2, 3].map((i) => createRockGeometry(100 + i, new THREE.Vector3(1, 0.65 + 0.15 * i, 1 - 0.1 * i))),
    createRockGeometry(110, new THREE.Vector3(1.7, 0.38, 1.2)),
    createRockGeometry(111, new THREE.Vector3(1.4, 0.3, 1.5)),
    createRockGeometry(120, new THREE.Vector3(0.75, 1.45, 0.7)),
    createRockGeometry(121, new THREE.Vector3(0.9, 1.15, 0.6)),
    createRockGeometry(130, new THREE.Vector3(1.3, 0.85, 1.1)),
  ];
  const useScans = scanned.length > 0;
  const shapeCount = useScans ? scanned.length : boulders.length;
  // Stone color per instance: plain grey granite, warm lichen-yellow, and dark wet stone. Scans get subtler tints.
  const tints = (useScans ? ['#ffffff', '#ffffff', '#f0e8d0', '#dde2e8', '#cfccc6'] : ['#ffffff', '#ffffff', '#e8dcb0', '#c8cfd8', '#b8b4ac']).map(
    (c) => new THREE.Color(c),
  );
  const tintOf = new Map<THREE.Matrix4, THREE.Color>();
  // Pebbles are small and numerous, so they get a much coarser mesh.
  const pebbles = [0, 1].map((i) => createRockGeometry(300 + i, new THREE.Vector3(1, 0.55, 0.85), 1));
  const standing = [0, 1].map((i) => createRockGeometry(200 + i, new THREE.Vector3(0.55, 2.6, 0.4)));

  const matrices: THREE.Matrix4[][] = Array.from({ length: shapeCount }, () => []);
  const placements: RockPlacement[] = [];
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const place = (list: THREE.Matrix4[], x: number, z: number, size: number, sink: number, tilt = 0.25) => {
    e.set((rand() - 0.5) * tilt, rand() * Math.PI * 2, (rand() - 0.5) * tilt);
    q.setFromEuler(e);
    s.set(size * (0.8 + rand() * 0.4), size * (0.8 + rand() * 0.4), size * (0.8 + rand() * 0.4));
    // Scans have their base at y = 0; procedural rocks are centered, so they sink deeper by construction.
    const shape = matrices.indexOf(list);
    const y = height(x, z) - sink * size * (useScans && shape >= 0 ? 0.35 * scanned[shape].aspect + 0.05 : 1);
    const m = new THREE.Matrix4().compose(p.set(x, y, z), q, s);
    const color = tints[Math.floor(rand() * tints.length)];
    tintOf.set(m, color);
    list.push(m);
    if (useScans && shape >= 0) {
      placements.push({ shape, matrix: m, color, size, center: new THREE.Vector3(x, y + size * 0.4, z) });
    }
  };
  const pickShape = () => matrices[Math.floor(rand() * shapeCount)];

  // Scattered boulders: clustered by noise, more on hills and along the beach.
  const half = TERRAIN_SIZE / 2 - 30;
  for (let i = 0; i < 9000 * params.rocks; i++) {
    const x = (rand() * 2 - 1) * half, z = (rand() * 2 - 1) * half;
    const h = height(x, z);
    if (h < -0.5) continue;
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
    place(pickShape(), x, z, size, 0.35, 0.4);
    const n = 2 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const a = rand() * Math.PI * 2, d = size * (0.45 + rand() * 0.4);
      place(pickShape(), x + Math.cos(a) * d, z + Math.sin(a) * d, size * (0.25 + rand() * 0.35), 0.25, 0.6);
    }
  }

  if (!useScans) boulders.forEach((geo, i) => {
    if (matrices[i].length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, material, matrices[i].length);
    matrices[i].forEach((m, k) => {
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, tintOf.get(m)!);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });

  // Pebbles scattered everywhere on land, denser where boulders cluster.
  const pebbleMatrices: THREE.Matrix4[][] = pebbles.map(() => []);
  for (let i = 0; i < 14000 * params.rocks; i++) {
    const x = (rand() * 2 - 1) * half, z = (rand() * 2 - 1) * half;
    const h = height(x, z);
    if (h < 0.3) continue;
    const cluster = THREE.MathUtils.smoothstep(noise(x * 0.006, z * 0.006), 0.1, 0.7);
    if (rand() > 0.3 + cluster * 0.7) continue;
    if (useScans) place(pickShape(), x, z, 0.12 + rand() * 0.3, 0.25, 0.6);
    else place(pebbleMatrices[i % 2], x, z, 0.15 + rand() * 0.35, 0.25, 0.6);
  }
  if (!useScans) pebbles.forEach((geo, i) => {
    if (pebbleMatrices[i].length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, material, pebbleMatrices[i].length);
    pebbleMatrices[i].forEach((m, k) => mesh.setMatrixAt(k, m));
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });

  // A small ring of standing stones on the bluff above the beach, near the start view.
  const ring: THREE.Matrix4[][] = standing.map(() => []);
  const cx = 30, cz = -40, radius = 7;
  for (let i = 0; i < 7; i++) {
    if (i === 4) continue; // one fallen gap
    const a = (i / 7) * Math.PI * 2 + rand() * 0.2;
    const x = cx + Math.cos(a) * radius, z = cz + Math.sin(a) * radius;
    e.set((rand() - 0.5) * 0.15, -a, (rand() - 0.5) * 0.15);
    q.setFromEuler(e);
    const size = 1.3 + rand() * 0.5;
    s.set(size, size, size);
    ring[i % 2].push(new THREE.Matrix4().compose(p.set(x, height(x, z) - 0.25, z), q, s));
  }
  standing.forEach((geo, i) => {
    const mesh = new THREE.InstancedMesh(geo, material, ring[i].length);
    ring[i].forEach((m, k) => mesh.setMatrixAt(k, m));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });

  if (!useScans) return { group, update: () => {} };
  const field = new ScannedRockField(scanned, placements);
  group.add(field.group);
  return { group, update: (camera) => field.update(camera) };
}
