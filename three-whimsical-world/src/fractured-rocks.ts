import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise3D } from 'simplex-noise';
import { groundUniforms } from './ground';
import { patchMoss, type ScannedRock } from './scanned-rocks';

/**
 * Procedural fractured rocks: a lumpy cloud of points around an ellipsoid is cut by random fracture planes
 * (points beyond a plane are pushed onto it) and wrapped in its convex hull. The cuts become broad flat faces
 * with sharp edges (creased normals) between rounded, weathered sides, the way split granite looks. The scanned
 * rock texture is projected on triplanar in world space, so a rock of any size keeps the same grain.
 *
 * Shapes come out normalized like the scans (base at y = 0, 1 unit across), so they join the scanned rocks in
 * the same instanced field and placement code, and the scans' 17 shapes stop repeating.
 */

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Kind {
  /** Ellipsoid proportions before cutting. */
  stretch: [number, number, number];
  /** Number of fracture planes. */
  cuts: number;
  /** How lumpy the uncut surface is. */
  lump: number;
  /** How steep the fracture planes run: 0 = any direction, 1 = vertical faces only (tall stones). */
  vertical: number;
  /** How deep cuts bite: 0.55 shaves the sides, lower carves the rock into a block. */
  depth: number;
  /** The broken top: how far it slopes (0 = level) and how much of the height it keeps. */
  topSlope: number;
  topDepth: number;
}

const KINDS: Record<string, Kind> = {
  // Rounded, weathered boulder with a few broken faces.
  boulder: { stretch: [1, 0.72, 0.88], cuts: 5, lump: 0.22, vertical: 0.2, depth: 0.62, topSlope: 0.4, topDepth: 0.85 },
  // Angular block, split on most sides.
  block: { stretch: [1.15, 0.85, 0.95], cuts: 10, lump: 0.1, vertical: 0.35, depth: 0.5, topSlope: 0.5, topDepth: 0.75 },
  // Low flat slab, like bedrock breaking through the turf.
  slab: { stretch: [1.6, 0.42, 1.15], cuts: 8, lump: 0.12, vertical: 0.6, depth: 0.55, topSlope: 0.25, topDepth: 0.7 },
  // Tall broken crag for outcrops.
  crag: { stretch: [0.85, 1.35, 0.75], cuts: 11, lump: 0.14, vertical: 0.55, depth: 0.5, topSlope: 0.9, topDepth: 0.72 },
  // Standing stone: a tall, thin split slab.
  standing: { stretch: [0.62, 2.5, 0.34], cuts: 7, lump: 0.07, vertical: 0.8, depth: 0.6, topSlope: 1.1, topDepth: 0.6 },
};

function fracture(seed: number, kind: Kind) {
  const rand = mulberry32(seed);
  const noise = createNoise3D(rand);
  const [sx, sy, sz] = kind.stretch;
  const pts: THREE.Vector3[] = [];
  const N = 320;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    // Fibonacci sphere: even coverage, so the hull has no big bald patches.
    const y = 1 - (2 * (i + 0.5)) / N;
    const r = Math.sqrt(1 - y * y);
    const d = new THREE.Vector3(Math.cos(golden * i) * r, y, Math.sin(golden * i) * r);
    const lump = 1 + kind.lump * noise(d.x * 1.3, d.y * 1.3, d.z * 1.3) + kind.lump * 0.35 * noise(d.x * 3.4, d.y * 3.4, d.z * 3.4);
    pts.push(d.multiplyScalar(0.5 * lump).multiply(new THREE.Vector3(sx, sy, sz)));
  }
  const n = new THREE.Vector3();
  const cut = (normal: THREE.Vector3, depth: number) => {
    let max = -Infinity;
    for (const p of pts) max = Math.max(max, p.dot(normal));
    const d = max * depth;
    for (const p of pts) {
      const s = p.dot(normal) - d;
      if (s > 0) p.addScaledVector(normal, -s);
    }
  };
  for (let k = 0; k < kind.cuts; k++) {
    const a = rand() * Math.PI * 2;
    // Steepness: vertical kinds cut mostly from the sides.
    const tilt = (rand() * 2 - 1) * (1 - kind.vertical) * 1.2;
    n.set(Math.cos(a), tilt, Math.sin(a)).normalize();
    cut(n, kind.depth + rand() * (1 - kind.depth) * 0.6);
  }
  // A sloping broken top, and a flat base for the part that sits in the ground.
  const ta = rand() * Math.PI * 2;
  n.set(Math.cos(ta) * kind.topSlope, 1, Math.sin(ta) * kind.topSlope).normalize();
  cut(n, kind.topDepth + rand() * 0.1);
  cut(new THREE.Vector3(0, -1, 0), 0.7);

  let geometry: THREE.BufferGeometry = new ConvexGeometry(pts);
  // Sharp edges between fracture faces, smooth shading across the gently curved weathered sides.
  geometry = toCreasedNormals(geometry, THREE.MathUtils.degToRad(32));

  // Normalize like the scans: footprint centered, base at y = 0, 1 unit across.
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const width = Math.max(size.x, size.z);
  const center = box.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -box.min.y, -center.z);
  geometry.scale(1 / width, 1 / width, 1 / width);
  geometry.computeBoundingSphere();
  const aspect = size.y / width;

  // Vertex colors: granite grain, darker toward the ground line, and orange lichen on the shaded sides.
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const nor = geometry.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const stone = new THREE.Color('#a39d92'), dark = new THREE.Color('#6b665d'), lichen = new THREE.Color('#c08a32');
  const c = new THREE.Color(), v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const grain = 0.5 + 0.5 * noise(v.x * 5 + 11, v.y * 5, v.z * 5);
    c.copy(dark).lerp(stone, grain);
    const spots = noise(v.x * 7 - 3, v.y * 7, v.z * 7 + 5);
    const side = 1 - Math.abs(nor.getY(i));
    c.lerp(lichen, THREE.MathUtils.smoothstep(spots, 0.45, 0.75) * side * 0.7);
    c.multiplyScalar(0.6 + 0.4 * THREE.MathUtils.smoothstep(v.y / Math.max(aspect, 0.2), 0.0, 0.25));
    c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return { geometry, aspect };
}

/** Lit rock material: vertex colors, the scanned rock texture triplanar in world space as detail, and moss. */
export function createFracturedRockMaterial() {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  if (groundUniforms.tGroundDiff.value) material.defines = { USE_GROUND: '' };
  material.onBeforeCompile = (shader) => {
    // Moss first: it declares vMossPos (world position) and appends after normal_fragment_maps; the rock detail
    // below is inserted ahead of it, so moss lies over the textured stone.
    patchMoss(shader);
    Object.assign(shader.uniforms, groundUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        #ifdef USE_GROUND
          uniform sampler2DArray tGroundDiff;
          uniform sampler2DArray tGroundNorm;
          uniform vec3 uGroundMean[5];
          uniform float uGroundDetail;
        #endif`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        #ifdef USE_GROUND
        {
          // Triplanar rock scan (ground layer 3), as detail over the vertex colors, with its normal map.
          vec3 Nw = inverseTransformDirection(normal, viewMatrix);
          vec3 tri = pow(abs(Nw), vec3(4.0));
          tri /= tri.x + tri.y + tri.z;
          float s = 0.22;
          vec3 P = vMossPos * s;
          vec3 cX = texture(tGroundDiff, vec3(P.zy, 3.0)).rgb;
          vec3 cY = texture(tGroundDiff, vec3(P.xz, 3.0)).rgb;
          vec3 cZ = texture(tGroundDiff, vec3(P.xy, 3.0)).rgb;
          vec3 detail = (cX * tri.x + cY * tri.y + cZ * tri.z) / uGroundMean[3];
          float fade = (1.0 - smoothstep(80.0, 300.0, distance(vMossPos, cameraPosition))) * uGroundDetail;
          diffuseColor.rgb *= mix(vec3(1.0), detail, mix(0.4, 1.0, fade));
          vec3 nX = texture(tGroundNorm, vec3(P.zy, 3.0)).xyz * 2.0 - 1.0;
          vec3 nY = texture(tGroundNorm, vec3(P.xz, 3.0)).xyz * 2.0 - 1.0;
          vec3 nZ = texture(tGroundNorm, vec3(P.xy, 3.0)).xyz * 2.0 - 1.0;
          // Whiteout blend per projection, swizzled back to world axes.
          nX = vec3(nX.xy + Nw.zy, abs(nX.z) * Nw.x);
          nY = vec3(nY.xy + Nw.xz, abs(nY.z) * Nw.y);
          nZ = vec3(nZ.xy + Nw.xy, abs(nZ.z) * Nw.z);
          vec3 nw = normalize(nX.zyx * tri.x + nY.xzy * tri.y + nZ.xyz * tri.z);
          normal = normalize(mix(normal, (viewMatrix * vec4(nw, 0.0)).xyz, fade));
        }
        #endif`,
      );
  };
  return material;
}

/** Every fractured shape for one world: two variants of each kind. `standing` is kept apart for the stone ring. */
export function createFracturedRocks(seed: number) {
  const material = createFracturedRockMaterial();
  const make = (name: string, variant: number): ScannedRock => {
    const { geometry, aspect } = fracture(seed * 31 + variant * 977 + name.length * 131, KINDS[name]);
    return { name: `fractured_${name}_${variant}`, lod0: geometry, lod1: geometry, material, aspect };
  };
  const field = ['boulder', 'block', 'slab', 'crag'].flatMap((name) => [make(name, 0), make(name, 1)]);
  const standing = [make('standing', 0), make('standing', 1)];
  return { field, standing, material };
}
