import * as THREE from 'three';
import { createWorld, type WorldFns, type WorldParams } from './worldgen';
import { createTerrainMesh, terrainUniforms } from './terrain';
import { createFarLand } from './far';
import { createRocks, type Rocks } from './rocks';
import type { ScannedRock } from './scanned-rocks';
import { Trees } from './trees';
import { Grass } from './grass';
import { quality } from './quality';
import { GroundCover } from './cover';
import { Life } from './life';

/** Everything generated from a seed and params. Dispose it and build a new one to regenerate. */
export class World {
  readonly group = new THREE.Group();
  readonly fns: WorldFns;
  private trees: Trees;
  private grass: Grass;
  private cover: GroundCover;
  private rocks: Rocks;
  /** Butterflies, birds and falling leaves; main.ts drives it with the clock and light. */
  readonly life: Life;

  constructor(params: WorldParams, renderer: THREE.WebGLRenderer, scannedRocks: ScannedRock[] = []) {
    this.fns = createWorld({ ...params });
    this.group.add(createTerrainMesh(this.fns));
    this.group.add(createFarLand(this.fns));
    this.rocks = createRocks(this.fns, scannedRocks);
    this.group.add(this.rocks.group);

    this.trees = new Trees(this.fns, renderer);
    this.grass = new Grass(this.fns);
    this.cover = new GroundCover(this.fns);
    this.life = new Life(this.fns);
    this.group.add(this.trees.group, this.grass.group, this.cover.group, this.life.group);
  }

  get height() {
    return this.fns.height;
  }

  /** Per-frame streaming of grass/cover chunks and tree detail levels. `fill` builds everything nearby at once. */
  update(camera: THREE.Camera, fill = false) {
    terrainUniforms.uGrassRadius.value = quality.grassRadius;
    this.grass.update(camera.position, fill ? Infinity : 3);
    this.cover.update(camera.position, fill ? Infinity : 2);
    this.trees.update(camera);
    this.rocks.update(camera);
  }

  dispose() {
    this.trees.dispose();
    this.grass.dispose();
    this.cover.dispose();
    this.life.dispose();
    // Free everything generated for this world; scanned-rock geometry and materials are shared, so they stay.
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
      if (!mesh.geometry?.userData.shared) mesh.geometry?.dispose();
      for (const m of [mesh.material].flat()) if (!m?.userData.shared) m?.dispose();
    });
    this.group.clear();
  }
}
