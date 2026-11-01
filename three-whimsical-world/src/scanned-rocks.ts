import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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

/** World-space moss on upward faces, broken up by noise, on top of the scanned color. */
/** How much extra moss grows on scanned rocks (0..1); shared by every rock material. */
export const rockMoss = { uMossAmount: { value: 0.5 } };

function addMoss(material: THREE.MeshStandardMaterial) {
  material.onBeforeCompile = (shader) => patchMoss(shader);
}

/**
 * Patches a lit rock shader with the moss. Also declares `vMossPos` (world position, instancing aware) in both
 * stages, for other rock patches to reuse.
 */
export function patchMoss(shader: THREE.WebGLProgramParametersWithUniforms) {
  Object.assign(shader.uniforms, rockMoss);
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
      varying vec3 vMossPos;
      uniform float uMossAmount;
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
        // Only on upward faces, never near the salty shoreline.
        float moss = smoothstep(0.6, 0.92, worldNormal.y + (n - 0.5) * 0.5) * smoothstep(2.5, 6.0, vMossPos.y);
        vec3 mossColor = vec3(0.075, 0.09, 0.035) * (0.75 + 0.5 * n);
        diffuseColor.rgb = mix(diffuseColor.rgb, mossColor, moss * uMossAmount);
        roughnessFactor = mix(roughnessFactor, 0.95, moss);
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
