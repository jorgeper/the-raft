import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { TERRAIN_SIZE } from './terrain';
import type { WorldFns } from './worldgen';

const FAR_SIZE = 16000;
const FAR_SEGMENTS = 400;

/**
 * Low-detail land beyond the playable terrain: the same meadow/forest continuing past the edges,
 * plus islands and mountains across the sea. It's mostly seen through haze, so color carries it.
 */
export function createFarLand(world: WorldFns) {
  const { height } = world;
  let s = world.params.seed * 31 + 99;
  const noise = createNoise2D(() => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  });
  const ridged = (x: number, z: number) => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < 5; i++) {
      sum += amp * (1 - Math.abs(noise(x * freq, z * freq)));
      norm += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum / norm;
  };

  const farHeight = (x: number, z: number) => {
    let h = height(x, z);
    // Islands rise out of the sea beyond ~1.6 km offshore; a big mountainous one dominates the horizon.
    const offshore = THREE.MathUtils.smoothstep(x, 1500, 2600);
    const islandMask = THREE.MathUtils.smoothstep(noise(x * 0.00045, z * 0.00045) + 0.3 * noise(x * 0.002, z * 0.002), 0.05, 0.45);
    const peaks = ridged(x * 0.0009, z * 0.0009);
    h = Math.max(h, -40 + offshore * islandMask * (60 + 260 * peaks * peaks));
    return h;
  };

  const geo = new THREE.PlaneGeometry(FAR_SIZE, FAR_SIZE, FAR_SEGMENTS, FAR_SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, farHeight(pos.getX(i), pos.getZ(i)));

  // Drop triangles fully inside the detailed terrain so the two don't overlap.
  const inner = TERRAIN_SIZE / 2 - FAR_SIZE / FAR_SEGMENTS;
  const inside = (i: number) => Math.abs(pos.getX(i)) < inner && Math.abs(pos.getZ(i)) < inner;
  const src = geo.index!.array;
  const kept: number[] = [];
  for (let t = 0; t < src.length; t += 3) {
    if (!(inside(src[t]) && inside(src[t + 1]) && inside(src[t + 2]))) kept.push(src[t], src[t + 1], src[t + 2]);
  }
  geo.setIndex(kept);
  geo.computeVertexNormals();

  const normals = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const meadow = new THREE.Color('#4a6a22'), forest = new THREE.Color('#1f3418'), rock = new THREE.Color('#6b6a66');
  const sand = new THREE.Color('#bfae80'), seabed = new THREE.Color('#5a5440');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const slope = 1 - normals.getY(i);
    // Same forest map as the playable area, plus extra woods on the islands.
    const woods = Math.max(world.forest(x, z), THREE.MathUtils.smoothstep(x, 1500, 2000) * THREE.MathUtils.smoothstep(noise(x * 0.0012 + 40, z * 0.0012), -0.3, 0.2));
    c.copy(meadow).lerp(forest, Math.max(woods, THREE.MathUtils.smoothstep(y, 60, 140)));
    c.lerp(rock, THREE.MathUtils.smoothstep(slope, 0.25, 0.45) + THREE.MathUtils.smoothstep(y, 200, 280));
    c.lerp(sand, 1 - THREE.MathUtils.smoothstep(y, 1, 4));
    c.lerp(seabed, 1 - THREE.MathUtils.smoothstep(y, -4, 0));
    c.multiplyScalar(0.85 + 0.3 * (0.5 + 0.5 * noise(x * 0.01, z * 0.01)));
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 1,
    specularIntensity: 0.1,
    // Where it overlaps the detailed terrain at the seam, let the detailed one win.
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 8,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  return mesh;
}
