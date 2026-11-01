import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { weatherUniforms } from './weather';

/** One photoscanned rock, normalized to 1 unit across with its base at y = 0. */
export interface ScannedRock {
  name: string;
  lod0: THREE.BufferGeometry;
  lod1: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  /** Height / width of the scan, so tall rocks stay tall. */
  aspect: number;
}

const BASE = `${import.meta.env.BASE_URL}assets/rocks/`;

/** Geometries of every mesh in a glTF scene, keyed by mesh name, with node transforms baked in. */
function collect(scene: THREE.Object3D) {
  const out = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material }>();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    out.set(mesh.name, { geometry, material: mesh.material as THREE.Material });
  });
  return out;
}

/** Recenters on the footprint's middle, puts the base at y = 0, and scales to 1 unit across. */
function normalize(near: THREE.BufferGeometry, far: THREE.BufferGeometry) {
  near.computeBoundingBox();
  const box = near.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const width = Math.max(size.x, size.z);
  const center = box.getCenter(new THREE.Vector3());
  for (const g of [near, far]) {
    g.translate(-center.x, -box.min.y, -center.z);
    g.scale(1 / width, 1 / width, 1 / width);
    g.computeBoundingSphere();
  }
  return size.y / width;
}

const MAX_PONDS = 16;

/** World-space moss on upward faces, broken up by noise, on top of the scanned color. */
/** How much extra moss grows on scanned rocks (0..1); shared by every rock material. */
export const rockMoss = {
  uMossAmount: { value: 0.5 },
  /** Ponds as (x, z, radius, level): rocks around them are carpeted in moss down to the waterline. */
  uPonds: { value: Array.from({ length: MAX_PONDS }, () => new THREE.Vector4(1e6, 1e6, 0, 0)) },
};

/** Points the rock moss at this world's ponds. */
export function setRockPonds(ponds: { x: number; z: number; radius: number; level: number }[]) {
  rockMoss.uPonds.value.forEach((v, i) => {
    const p = ponds[i];
    if (p) v.set(p.x, p.z, p.radius, p.level);
    else v.set(1e6, 1e6, 0, 0);
  });
}

function addMoss(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => patchMoss(shader);
}

/**
 * Patches a lit rock shader with the moss. Also declares `vMossPos` (world position, instancing aware) in both
 * stages, for other rock patches to reuse.
 */
export function patchMoss(shader: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, rockMoss, weatherUniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vMossPos;')
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vMossPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;
      #else
        vMossPos = (modelMatrix * vec4(position, 1.0)).xyz;
      #endif`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
      #define MAX_PONDS ${MAX_PONDS}
      varying vec3 vMossPos;
      uniform float uMossAmount;
      uniform vec4 uPonds[MAX_PONDS];
      uniform float uWet;
      float mHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      float mNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(mHash(i), mHash(i + vec3(1, 0, 0)), f.x), mix(mHash(i + vec3(0, 1, 0)), mHash(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(mHash(i + vec3(0, 0, 1)), mHash(i + vec3(1, 0, 1)), f.x), mix(mHash(i + vec3(0, 1, 1)), mHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      {
        vec3 worldNormal = inverseTransformDirection(normal, viewMatrix);
        float n = mNoise(vMossPos * 1.7) * 0.6 + mNoise(vMossPos * 6.0) * 0.4;
        // Damp pond margins: moss creeps over the sides too, right down to the water.
        float wet = 0.0;
        for (int i = 0; i < MAX_PONDS; i++) {
          vec4 p = uPonds[i];
          float d = length(vMossPos.xz - p.xy) - p.z * 1.15;
          wet = max(wet, (1.0 - smoothstep(1.0, 7.0, d)) * smoothstep(p.w - 0.15, p.w + 0.05, vMossPos.y));
        }
        // Only on upward faces, never near the salty shoreline.
        float facing = worldNormal.y + (n - 0.5) * 0.5;
        float moss = max(smoothstep(0.6, 0.92, facing) * smoothstep(2.5, 6.0, vMossPos.y) * uMossAmount,
                         wet * smoothstep(-0.25, 0.45, facing + (n - 0.5) * 0.4));
        vec3 mossColor = mix(vec3(0.075, 0.09, 0.035), vec3(0.085, 0.12, 0.035), wet) * (0.75 + 0.5 * n);
        // Crustose lichen in round blotches with speckles around them: orange (Xanthoria, thickest on rocks by the
        // sea, as on real coasts) and pale grey-green map lichen, on the sides and tops but not in the overhangs.
        float blob = mNoise(vMossPos * 2.3 + 11.0) * 0.7 + mNoise(vMossPos * 9.0 - 3.0) * 0.3;
        float speck = mNoise(vMossPos * 23.0 + 5.0);
        float lichenAt = smoothstep(-0.35, 0.2, worldNormal.y) * (1.0 - wet);
        float coast = 1.0 - smoothstep(4.0, 12.0, vMossPos.y);
        float orange = max(smoothstep(0.7 - 0.08 * coast, 0.75 - 0.08 * coast, blob), smoothstep(0.86 - 0.08 * coast, 0.9, speck) * 0.8)
          * lichenAt * (0.35 + 0.65 * coast);
        float pale = smoothstep(0.64, 0.7, mNoise(vMossPos * 1.6 - 21.0) * 0.75 + speck * 0.25) * lichenAt * (1.0 - orange);
        vec3 orangeLichen = mix(vec3(0.5, 0.2, 0.04), vec3(0.62, 0.36, 0.07), mNoise(vMossPos * 5.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, orangeLichen, orange * 0.75);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.45, 0.35) * (0.8 + 0.4 * speck), pale * 0.55);
        diffuseColor.rgb = mix(diffuseColor.rgb, mossColor, moss);
        roughnessFactor = mix(roughnessFactor, 0.95, moss);
        // After rain the stone darkens and turns glossy (tops and faces to the sky first, the overhangs stay dry),
        // so it glints when the sun comes back out. Moss soaks it up and stays matte.
        if (uWet > 0.0) {
          float soaked = uWet * smoothstep(-0.6, 0.3, worldNormal.y + (n - 0.5) * 0.6);
          diffuseColor.rgb *= mix(1.0, 0.68, soaked * (1.0 - 0.5 * moss));
          roughnessFactor = mix(roughnessFactor, 0.55, soaked * (1.0 - moss));
        }
      }`,
    );
}

/**
 * Loads the rocks built by `npm run assets`. Returns an empty list when they haven't been fetched, so the
 * scene falls back to procedural rocks.
 */
export async function loadScannedRocks(): Promise<ScannedRock[]> {
  const res = await fetch(`${BASE}manifest.json`).catch(() => null);
  if (!res?.ok) {
    console.warn('Scanned rocks not found; using procedural rocks. Run `npm run assets` to fetch them.');
    return [];
  }
  const manifest = (await res.json()) as { rocks: string[] };
  const loader = new GLTFLoader();
  const rocks: ScannedRock[] = [];
  await Promise.all(
    manifest.rocks.map(async (id) => {
      const [near, far] = await Promise.all([loader.loadAsync(`${BASE}${id}.lod0.glb`), loader.loadAsync(`${BASE}${id}.lod1.glb`)]);
      const nearMeshes = collect(near.scene), farMeshes = collect(far.scene);
      for (const [name, { geometry, material }] of nearMeshes) {
        const farGeometry = farMeshes.get(name)?.geometry ?? geometry;
        const aspect = normalize(geometry, farGeometry);
        const mat = material as THREE.MeshStandardMaterial;
        if (!mat.userData.shared) addMoss(mat);
        // Loaded once and reused by every generated world; World.dispose() leaves shared resources alone.
        geometry.userData.shared = farGeometry.userData.shared = mat.userData.shared = true;
        rocks.push({ name, lod0: geometry, lod1: farGeometry, material: mat, aspect });
      }
    }),
  );
  rocks.sort((a, b) => a.name.localeCompare(b.name));
  return rocks;
}
