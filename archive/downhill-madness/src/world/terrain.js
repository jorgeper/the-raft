import * as THREE from 'three';
import { centerX, groundY, CHUNK_LENGTH, TRAIL_HALF_WIDTH } from './trail.js';
import { fbm2 } from '../utils/noise.js';
import { clamp, lerp, smoothstep } from '../utils/math.js';

// Vertex-colored terrain ribbon: warm dirt trail, grassy verges, hillside
// rising on the left, valley falling away on the right (spec §7).

const ROWS = 26; // every 2 m along s
const COLS = 34; // across lateral -34..+34 m

const DIRT = new THREE.Color(0x8a6a45);
const DIRT_DARK = new THREE.Color(0x6f5436);
const GRASS = new THREE.Color(0x5d8f3d);
const GRASS_LUSH = new THREE.Color(0x467c33);
const MOSS = new THREE.Color(0x7a9a4c);
const MEADOW = new THREE.Color(0x7fae4e);
const GOLDEN = new THREE.Color(0xb1a04a);

export function offTrailHeight(s, l) {
  const a = Math.abs(l);
  if (a <= TRAIL_HALF_WIDTH + 0.5) return 0;
  const d = a - (TRAIL_HALF_WIDTH + 0.5);
  const n = fbm2(s * 0.03, l * 0.06);
  if (l < 0) {
    // hillside rises on the left
    return Math.pow(d, 1.45) * 0.22 * (0.7 + n * 0.8) + n * 1.2 * smoothstep(0, 8, d);
  }
  // valley falls away on the right, with bumps
  return -Math.pow(d, 1.25) * 0.3 * (0.6 + n * 0.5) + n * 1.6 * smoothstep(0, 10, d);
}

export function buildTerrainChunk(chunkIndex, phaseParams) {
  const s0 = chunkIndex * CHUNK_LENGTH;
  const positions = [];
  const colors = [];
  const indices = [];
  const tmp = new THREE.Color();

  for (let r = 0; r <= ROWS; r++) {
    const s = s0 + (r / ROWS) * CHUNK_LENGTH;
    const cx = centerX(s);
    const gy = groundY(s);
    for (let c = 0; c <= COLS; c++) {
      const l = (c / COLS - 0.5) * 68;
      const y = gy + offTrailHeight(s, l);
      // local coords relative to chunk origin (s0 start, on centerline at s0)
      positions.push(cx + l - centerX(s0), y - groundY(s0), -(s - s0));

      // color: dirt center -> grass -> meadow/moss variation
      const a = Math.abs(l);
      const edgeNoise = fbm2(s * 0.11, l * 0.31) * 1.4;
      const trailT = smoothstep(1.6 + edgeNoise, 3.6 + edgeNoise, a);
      const n = fbm2(s * 0.05 + 7, l * 0.05);
      tmp.copy(DIRT).lerp(DIRT_DARK, fbm2(s * 0.4, l * 0.6) * 0.7);
      const grass = GRASS.clone().lerp(GRASS_LUSH, n);
      if (n > 0.62) grass.lerp(MOSS, smoothstep(0.62, 0.8, n));
      if (n < 0.35) grass.lerp(MEADOW, smoothstep(0.35, 0.2, n));
      // golden-hour tint creeps in during phase 4
      grass.lerp(GOLDEN, clamp(phaseParams.mix - 2.35, 0, 0.65) * 0.45 * n);
      tmp.lerp(grass, trailT);
      // subtle brightness variation so big surfaces never look flat
      const b = 0.92 + fbm2(s * 0.9, l * 0.9) * 0.16;
      colors.push(tmp.r * b, tmp.g * b, tmp.b * b);
    }
  }

  const W = COLS + 1;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * W + c;
      indices.push(i, i + 1, i + W, i + 1, i + W + 1, i + W);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, terrainMaterial());
  mesh.position.set(centerX(s0), groundY(s0), -s0);
  mesh.receiveShadow = true;
  mesh.userData.ownGeometry = true;
  return mesh;
}

let _terrainMat = null;
function terrainMaterial() {
  if (!_terrainMat) {
    _terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  }
  return _terrainMat;
}
