import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Photoscanned CC0 plants from Poly Haven, built by `npm run assets` into public/assets/plants/ (alpha cards,
 * simplified per variant). Loaded once before the world is generated; ground cover falls back to its procedural
 * plants when they're missing.
 */
export const plants = {
  /** fern_02's four variants, each origin at its base. */
  fern: null as { geometries: THREE.BufferGeometry[]; material: THREE.MeshStandardMaterial } | null,
};

export async function loadPlants(base = `${import.meta.env.BASE_URL}assets/plants/`): Promise<void> {
  try {
    const gltf = await new GLTFLoader().loadAsync(base + 'fern_02.glb');
    const geometries: THREE.BufferGeometry[] = [];
    let material: THREE.MeshStandardMaterial | null = null;
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry.clone();
      geo.userData.shared = true;
      geometries.push(geo);
      material ??= mesh.material as THREE.MeshStandardMaterial;
    });
    if (!material || !geometries.length) throw new Error('fern_02.glb has no meshes');
    plants.fern = { geometries, material };
  } catch (err) {
    console.warn('Scanned plants not loaded (run `npm run assets`):', err);
  }
}
