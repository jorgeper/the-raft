import * as THREE from 'three';
import { createWorld, type WorldFns, type WorldParams } from './worldgen';
import { createTerrainMesh, createDepthTexture, terrainUniforms } from './terrain';
import { createFarLand } from './far';
import { createRocks } from './rocks';
import { Trees } from './trees';
import { Grass, GRASS_RADIUS } from './grass';
import { GroundCover } from './cover';

export const MAX_WATER_DEPTH = 10;

/** Everything generated from a seed and params. Dispose it and build a new one to regenerate. */
export class World {
  readonly group = new THREE.Group();
  readonly fns: WorldFns;
  readonly depthTexture: THREE.DataTexture;
  private trees: Trees;
  private grass: Grass;
  private cover: GroundCover;

  constructor(params: WorldParams, renderer: THREE.WebGLRenderer) {
    this.fns = createWorld({ ...params });
    this.group.add(createTerrainMesh(this.fns));
    this.depthTexture = createDepthTexture(this.fns.height, 512, MAX_WATER_DEPTH);
    this.group.add(createFarLand(this.fns));
    this.group.add(createRocks(this.fns));

    this.trees = new Trees(this.fns, renderer);
    this.grass = new Grass(this.fns);
    terrainUniforms.uGrassRadius.value = GRASS_RADIUS;
    this.cover = new GroundCover(this.fns);
    this.group.add(this.trees.group, this.grass.group, this.cover.group);
  }

  get height() {
    return this.fns.height;
  }

  /** Per-frame streaming of grass/cover chunks and tree detail levels. `fill` builds everything nearby at once. */
  update(camera: THREE.Camera, fill = false) {
    this.grass.update(camera.position, fill ? Infinity : 3);
    this.cover.update(camera.position, fill ? Infinity : 2);
    this.trees.update(camera);
  }

  dispose() {
    this.trees.dispose();
    this.grass.dispose();
    this.cover.dispose();
    this.depthTexture.dispose();
    // Terrain, far land and rocks own their geometry and materials outright.
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry?.dispose();
      for (const m of [mesh.material].flat()) m?.dispose();
    });
    this.group.clear();
  }
}
