import * as THREE from 'three';
import { createNoise2D, createNoise3D } from 'simplex-noise';
import { TERRAIN_SIZE } from './terrain';
import type { WorldFns } from './worldgen';

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

export function createRocks(world: WorldFns) {
  const { height, params } = world;
  const rand = mulberry32(params.seed * 13 + 7331);
  const noise = createNoise2D(rand);
  const material = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.9, specularIntensity: 0.3 });
  const group = new THREE.Group();

  const boulders = [0, 1, 2, 3].map((i) => createRockGeometry(100 + i, new THREE.Vector3(1, 0.65 + 0.15 * i, 1 - 0.1 * i)));
  // Pebbles are small and numerous, so they get a much coarser mesh.
  const pebbles = [0, 1].map((i) => createRockGeometry(300 + i, new THREE.Vector3(1, 0.55, 0.85), 1));
  const standing = [0, 1].map((i) => createRockGeometry(200 + i, new THREE.Vector3(0.55, 2.6, 0.4)));

  const matrices: THREE.Matrix4[][] = boulders.map(() => []);
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const place = (list: THREE.Matrix4[], x: number, z: number, size: number, sink: number, tilt = 0.25) => {
    e.set((rand() - 0.5) * tilt, rand() * Math.PI * 2, (rand() - 0.5) * tilt);
    q.setFromEuler(e);
    s.set(size * (0.8 + rand() * 0.4), size * (0.8 + rand() * 0.4), size * (0.8 + rand() * 0.4));
    list.push(new THREE.Matrix4().compose(p.set(x, height(x, z) - sink * size, z), q, s));
  };

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
    place(matrices[Math.floor(rand() * boulders.length)], x, z, size, big ? 0.3 : 0.2);
  }

  boulders.forEach((geo, i) => {
    if (matrices[i].length === 0) return;
    const mesh = new THREE.InstancedMesh(geo, material, matrices[i].length);
    matrices[i].forEach((m, k) => mesh.setMatrixAt(k, m));
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
    place(pebbleMatrices[i % 2], x, z, 0.15 + rand() * 0.35, 0.25, 0.6);
  }
  pebbles.forEach((geo, i) => {
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

  return group;
}
