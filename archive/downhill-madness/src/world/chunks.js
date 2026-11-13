import * as THREE from 'three';
import { CHUNK_LENGTH, CHUNKS_AHEAD, CHUNKS_BEHIND, centerX, groundY } from './trail.js';
import { phaseParamsAt } from './phases.js';
import { buildTerrainChunk } from './terrain.js';
import { buildVegetationChunk } from './vegetation.js';
import { makeRng, hash2 } from '../utils/rng.js';

// God-ray shafts: additive gradient billboards slicing through the canopy.
let _rayGeo = null;
function rayGeometry() {
  return (_rayGeo ||= new THREE.PlaneGeometry(1, 1));
}
let _rayMat = null;
function rayMaterial() {
  if (_rayMat) return _rayMat;
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, 'rgba(255, 244, 214, 0.55)');
  grad.addColorStop(0.7, 'rgba(255, 244, 214, 0.12)');
  grad.addColorStop(1, 'rgba(255, 244, 214, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 256);
  const tex = new THREE.CanvasTexture(canvas);
  _rayMat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide, fog: false, opacity: 0.7,
  });
  return _rayMat;
}

function buildGodRays(chunkIndex, phaseParams) {
  // strongest in the deep forest phase (mix ~1)
  const strength = Math.max(0, 1 - Math.abs(phaseParams.mix - 1) * 1.4);
  if (strength < 0.15) return null;
  const rng = makeRng(hash2(chunkIndex, 555));
  const group = new THREE.Group();
  const n = Math.round(4 * strength);
  for (let i = 0; i < n; i++) {
    const s = chunkIndex * CHUNK_LENGTH + rng.range(5, CHUNK_LENGTH - 5);
    const l = rng.range(-10, 10);
    const h = rng.range(9, 16);
    const ray = new THREE.Mesh(rayGeometry(), rayMaterial());
    ray.scale.set(rng.range(1.2, 3), h, 1);
    ray.position.set(centerX(s) + l, groundY(s) + h * 0.42, -s);
    ray.rotation.z = rng.range(0.3, 0.5) * rng.sign() * 0.6;
    ray.rotation.y = rng.range(0, Math.PI);
    group.add(ray);
  }
  return group;
}

export function createChunkManager(worldGroup, { spawner = null } = {}) {
  const chunks = new Map(); // index -> { group, obstacles }

  function buildChunk(index) {
    const p = phaseParamsAt(index * CHUNK_LENGTH + CHUNK_LENGTH / 2);
    const group = new THREE.Group();
    group.add(buildTerrainChunk(index, p));
    group.add(buildVegetationChunk(index, p));
    const rays = buildGodRays(index, p);
    if (rays) group.add(rays);
    const obstacles = spawner ? spawner.spawnChunk(index) : [];
    worldGroup.add(group);
    return { group, obstacles };
  }

  function releaseChunk(index) {
    const chunk = chunks.get(index);
    if (!chunk) return;
    worldGroup.remove(chunk.group);
    if (spawner) spawner.releaseChunk(index, chunk.obstacles);
    chunk.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      else if (o.isMesh && o.userData.ownGeometry) o.geometry.dispose();
    });
    chunks.delete(index);
  }

  return {
    update(playerS) {
      const current = Math.floor(playerS / CHUNK_LENGTH);
      const lo = Math.max(0, current - CHUNKS_BEHIND);
      const hi = current + CHUNKS_AHEAD;
      for (let i = lo; i <= hi; i++) if (!chunks.has(i)) chunks.set(i, buildChunk(i));
      for (const idx of [...chunks.keys()]) if (idx < lo || idx > hi) releaseChunk(idx);
    },
    activeObstacles(playerS) {
      const current = Math.floor(playerS / CHUNK_LENGTH);
      const list = [];
      for (let i = current - 1; i <= current + 2; i++) {
        const c = chunks.get(i);
        if (c) list.push(...c.obstacles);
      }
      return list;
    },
    allObstacles() {
      const list = [];
      for (const c of chunks.values()) list.push(...c.obstacles);
      return list;
    },
    reset() {
      for (const idx of [...chunks.keys()]) releaseChunk(idx);
    },
  };
}
