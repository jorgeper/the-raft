import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeRng, hash2 } from '../utils/rng.js';
import { centerX, groundY, CHUNK_LENGTH, TRAIL_HALF_WIDTH } from './trail.js';
import { offTrailHeight } from './terrain.js';

// Organic, rounded, instanced PNW vegetation with out-of-phase wind wobble.
// All geometry procedural with baked vertex colors (spec §7).

export const windUniform = { value: 0 };

function swayMaterial(opts = {}) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    flatShading: true,
    ...opts,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = windUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 iOrigin = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 iOrigin = vec3(0.0);
        #endif
        float swayPh = uWind * 1.8 + iOrigin.x * 0.71 + iOrigin.z * 0.53;
        float swayAmt = (sin(swayPh) + 0.5 * sin(swayPh * 2.17 + 1.3)) * 0.045;
        float h = max(transformed.y, 0.0);
        transformed.x += swayAmt * h * h * 0.28;
        transformed.z += swayAmt * h * h * 0.17;`
      );
  };
  return mat;
}

function bakeColor(indexedGeo, color) {
  // mergeGeometries needs uniform indexing; non-indexed also flat-shades crisply
  const geo = indexedGeo.index ? indexedGeo.toNonIndexed() : indexedGeo;
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const c = new THREE.Color(color);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function jitterVerts(geo, amount, rng) {
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(
      i,
      pos.getX(i) + rng.range(-amount, amount),
      pos.getY(i) + rng.range(-amount, amount) * 0.6,
      pos.getZ(i) + rng.range(-amount, amount)
    );
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------- geometry builders (each returns one merged, colored geometry) ----------

function firGeometry(seed, tall) {
  const rng = makeRng(seed);
  const parts = [];
  const trunkH = tall ? rng.range(2.2, 3.2) : rng.range(1.2, 1.9);
  const trunk = new THREE.CylinderGeometry(0.14, 0.24, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(bakeColor(trunk, 0x6b4d33));
  const layers = tall ? rng.int(4, 5) : rng.int(3, 4);
  let y = trunkH * 0.75;
  let radius = tall ? rng.range(1.9, 2.5) : rng.range(1.4, 1.9);
  const green = new THREE.Color(0x4c8a40).lerp(new THREE.Color(0x69aa4e), rng.next());
  for (let i = 0; i < layers; i++) {
    const blobH = radius * rng.range(0.85, 1.1);
    const blob = new THREE.IcosahedronGeometry(radius, 1);
    blob.scale(1, blobH / radius * 0.75, 1);
    jitterVerts(blob, radius * 0.08, rng);
    blob.translate(rng.range(-0.15, 0.15), y + blobH * 0.3, rng.range(-0.15, 0.15));
    const shade = green.clone().multiplyScalar(0.82 + (i / layers) * 0.35);
    parts.push(bakeColor(blob, shade));
    y += blobH * rng.range(0.62, 0.75);
    radius *= rng.range(0.68, 0.78);
  }
  return mergeGeometries(parts);
}

function cedarGeometry(seed) {
  const rng = makeRng(seed);
  const parts = [];
  const trunkH = rng.range(3, 4.4);
  const trunk = new THREE.CylinderGeometry(0.18, 0.34, trunkH, 6);
  trunk.translate(0, trunkH / 2, 0);
  parts.push(bakeColor(trunk, 0x7a5138));
  const green = new THREE.Color(0x4a7c3f).lerp(new THREE.Color(0x6da24f), rng.next());
  let y = trunkH * 0.45, radius = rng.range(1.7, 2.1);
  for (let i = 0; i < 5; i++) {
    const cone = new THREE.ConeGeometry(radius, radius * 1.35, 7);
    jitterVerts(cone, radius * 0.13, rng);
    cone.translate(rng.range(-0.1, 0.1), y + radius * 0.5, rng.range(-0.1, 0.1));
    parts.push(bakeColor(cone, green.clone().multiplyScalar(0.85 + i * 0.06)));
    y += radius * 0.72;
    radius *= 0.78;
  }
  return mergeGeometries(parts);
}

function fernGeometry(seed) {
  const rng = makeRng(seed);
  const parts = [];
  const blades = rng.int(6, 9);
  for (let i = 0; i < blades; i++) {
    const len = rng.range(0.5, 0.95);
    const blade = new THREE.PlaneGeometry(0.16, len, 1, 4);
    const pos = blade.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const t = (pos.getY(v) + len / 2) / len; // 0 at base, 1 at tip
      pos.setZ(v, Math.sin(t * Math.PI * 0.6) * len * 0.55);
      pos.setX(v, pos.getX(v) * (1 - t * 0.85));
    }
    blade.translate(0, len / 2, 0);
    blade.rotateX(-rng.range(0.5, 1.15));
    blade.rotateY((i / blades) * Math.PI * 2 + rng.range(-0.3, 0.3));
    const g = new THREE.Color(0x4c8a3a).lerp(new THREE.Color(0x76b054), rng.next());
    parts.push(bakeColor(blade, g));
  }
  const geo = mergeGeometries(parts);
  geo.computeVertexNormals();
  return geo;
}

function flowerGeometry(seed, headColor) {
  const rng = makeRng(seed);
  const parts = [];
  const stems = rng.int(3, 5);
  for (let i = 0; i < stems; i++) {
    const h = rng.range(0.35, 0.7);
    const stem = new THREE.CylinderGeometry(0.015, 0.025, h, 4);
    const x = rng.range(-0.22, 0.22), z = rng.range(-0.22, 0.22);
    stem.translate(x, h / 2, z);
    parts.push(bakeColor(stem, 0x4e7a35));
    const head = new THREE.IcosahedronGeometry(rng.range(0.06, 0.11), 0);
    head.translate(x, h + 0.03, z);
    parts.push(bakeColor(head, headColor));
  }
  return mergeGeometries(parts);
}

function grassGeometry(seed) {
  const rng = makeRng(seed);
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const h = rng.range(0.25, 0.45);
    const p = new THREE.PlaneGeometry(0.3, h, 1, 2);
    const pos = p.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const t = (pos.getY(v) + h / 2) / h;
      pos.setX(v, pos.getX(v) * (1 - t * 0.7));
    }
    p.translate(0, h / 2, 0);
    p.rotateY((i / 3) * Math.PI);
    parts.push(bakeColor(p, new THREE.Color(0x5f9440).lerp(new THREE.Color(0x8ab55b), rng.next())));
  }
  return mergeGeometries(parts);
}

function rockGeometry(seed) {
  const rng = makeRng(seed);
  const r = rng.range(0.3, 0.8);
  const rock = new THREE.IcosahedronGeometry(r, 1);
  jitterVerts(rock, r * 0.24, rng);
  rock.scale(1, rng.range(0.55, 0.8), 1);
  // grey with mossy top
  const pos = rock.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const grey = new THREE.Color(0x8d9091), moss = new THREE.Color(0x6f9448);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, pos.getY(i) / r);
    c.copy(grey).lerp(moss, t * rng.range(0.5, 0.9));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  rock.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return rock;
}

function stumpGeometry(seed) {
  const rng = makeRng(seed);
  const h = rng.range(0.4, 0.9);
  const stump = new THREE.CylinderGeometry(0.32, 0.42, h, 7);
  stump.translate(0, h / 2, 0);
  jitterVerts(stump, 0.04, rng);
  return bakeColor(stump, 0x74553a);
}

// ---------- shared assets ----------

let _assets = null;
export function vegetationAssets() {
  if (_assets) return _assets;
  const std = swayMaterial();
  const leaf = swayMaterial({ side: THREE.DoubleSide });
  _assets = {
    types: [
      { name: 'fir1', geo: firGeometry(101, true), mat: std, shadow: true },
      { name: 'fir2', geo: firGeometry(202, true), mat: std, shadow: true },
      { name: 'fir3', geo: firGeometry(303, false), mat: std, shadow: true },
      { name: 'cedar', geo: cedarGeometry(404), mat: std, shadow: true },
      { name: 'fern', geo: fernGeometry(505), mat: leaf, shadow: false },
      { name: 'lupine', geo: flowerGeometry(606, 0x8f6fd8), mat: leaf, shadow: false },
      { name: 'poppy', geo: flowerGeometry(707, 0xe8823c), mat: leaf, shadow: false },
      { name: 'daisy', geo: flowerGeometry(808, 0xf5f2e3), mat: leaf, shadow: false },
      { name: 'grass', geo: grassGeometry(909), mat: leaf, shadow: false },
      { name: 'rock', geo: rockGeometry(111), mat: std, shadow: true },
      { name: 'stump', geo: stumpGeometry(222), mat: std, shadow: true },
    ],
  };
  return _assets;
}

// ---------- per-chunk instancing ----------

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _sc = new THREE.Vector3();

export function buildVegetationChunk(chunkIndex, phaseParams) {
  const rng = makeRng(hash2(chunkIndex, 991));
  const s0 = chunkIndex * CHUNK_LENGTH;
  const group = new THREE.Group();
  const { types } = vegetationAssets();

  const counts = {
    fir1: Math.round(14 * phaseParams.treeDensity),
    fir2: Math.round(14 * phaseParams.treeDensity),
    fir3: Math.round(10 * phaseParams.treeDensity),
    cedar: Math.round(8 * phaseParams.treeDensity),
    fern: Math.round(90 * phaseParams.fernDensity),
    lupine: Math.round(26 * phaseParams.flowerDensity),
    poppy: Math.round(20 * phaseParams.flowerDensity),
    daisy: Math.round(26 * phaseParams.flowerDensity),
    grass: 120,
    rock: 7,
    stump: 4,
  };

  for (const t of types) {
    const count = counts[t.name] || 0;
    if (count <= 0) continue;
    const inst = new THREE.InstancedMesh(t.geo, t.mat, count);
    inst.castShadow = t.shadow;
    inst.receiveShadow = false;
    const isTree = t.name.startsWith('fir') || t.name === 'cedar';
    const isFlowerish = ['lupine', 'poppy', 'daisy', 'grass', 'fern'].includes(t.name);
    for (let i = 0; i < count; i++) {
      const s = s0 + rng.range(0, CHUNK_LENGTH);
      // trees keep off the trail; small plants may hug its edge
      const minL = isTree ? TRAIL_HALF_WIDTH + rng.range(1.6, 3) : TRAIL_HALF_WIDTH + rng.range(0.2, 1.2);
      const maxL = isTree ? 30 : isFlowerish ? 16 : 24;
      const l = rng.sign() * rng.range(minL, maxL);
      const y = groundY(s) + offTrailHeight(s, l);
      _p.set(centerX(s) + l, y - 0.05, -s);
      _e.set(rng.range(-0.06, 0.06), rng.range(0, Math.PI * 2), rng.range(-0.06, 0.06));
      _q.setFromEuler(_e);
      const sc = isTree ? rng.range(0.8, 1.7) : rng.range(0.7, 1.4);
      _sc.set(sc * rng.range(0.9, 1.1), sc, sc * rng.range(0.9, 1.1));
      _m.compose(_p, _q, _sc);
      inst.setMatrixAt(i, _m);
    }
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }
  return group;
}
