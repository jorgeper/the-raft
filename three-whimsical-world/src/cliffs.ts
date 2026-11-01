import * as THREE from 'three';
import type { CliffInit, CliffRequest, CliffTile } from './cliff-worker';
import type { WorldFns } from './worldgen';

/**
 * Real rock on the cliffs. The terrain is a 2.5 m heightfield, so a gorge wall 30 m high is a couple of long
 * triangles: smooth, flat planes however they're shaded. Around the camera, a worker (`src/cliff-worker.ts`)
 * re-tessellates the steep cells at half a meter and pushes them out into buttresses, ledges and joints; the shell
 * draws with the terrain's own material (so the scans, the bedding colors, snow and wet all carry over) and fades back
 * onto the plain terrain with distance, where the relief no longer reads.
 */

/** Cells per tile (2.5 m each): 40 m tiles. */
const TILE = 16;
/** Tiles are built within this distance of the camera (m) and dropped beyond `DROP`. */
const BUILD = 210;
const DROP = 270;
/** The relief eases out between these distances (m), so a tile coming or going doesn't pop. */
export const CLIFF_FADE = [150, 195] as const;

export class Cliffs {
  readonly group = new THREE.Group();
  private worker: Worker;
  private tiles = new Map<string, THREE.Mesh | null>();
  private pending = new Set<string>();
  private tilesPerSide: number;
  private tileSize: number;
  private half: number;

  constructor(terrain: THREE.Mesh, fns: WorldFns, size: number, segments: number, private material: THREE.Material) {
    this.group.name = 'cliffs';
    this.tilesPerSide = Math.ceil(segments / TILE);
    this.tileSize = (size / segments) * TILE;
    this.half = size / 2;
    const g = terrain.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const heights = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) heights[i] = pos.getY(i);
    const init: CliffInit = {
      type: 'init',
      size,
      segments,
      heights,
      colors: (g.getAttribute('color').array as Float32Array).slice(),
      grass: (g.getAttribute('aGrass').array as Float32Array).slice(),
      splat: (g.getAttribute('aSplat').array as Float32Array).slice(),
      waterfalls: fns.waterfalls.map((w) => ({ x: w.x, z: w.z, dirX: w.dirX, dirZ: w.dirZ })),
      seed: fns.params.seed,
    };
    this.worker = new Worker(new URL('./cliff-worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<CliffTile>) => this.receive(e.data);
    this.worker.postMessage(init, [init.heights.buffer, init.colors.buffer, init.grass.buffer, init.splat.buffer]);
  }

  /** Asks for the tiles in reach (nearest first) and drops the ones left far behind. */
  update(camera: THREE.Vector3) {
    const want: { key: string; ti: number; tj: number; d: number }[] = [];
    const r = Math.ceil(BUILD / this.tileSize) + 1;
    const ci = Math.floor((camera.x + this.half) / this.tileSize), cj = Math.floor((camera.z + this.half) / this.tileSize);
    for (let tj = cj - r; tj <= cj + r; tj++) {
      for (let ti = ci - r; ti <= ci + r; ti++) {
        if (ti < 0 || tj < 0 || ti >= this.tilesPerSide || tj >= this.tilesPerSide) continue;
        const d = this.distanceTo(ti, tj, camera);
        if (d > BUILD) continue;
        const key = `${ti},${tj}`;
        if (this.tiles.has(key) || this.pending.has(key)) continue;
        want.push({ key, ti, tj, d });
      }
    }
    // A few requests in flight at a time, so the nearest tiles come back first as you move.
    want.sort((a, b) => a.d - b.d);
    for (const w of want) {
      if (this.pending.size >= 3) break;
      this.pending.add(w.key);
      const req: CliffRequest = { type: 'tile', key: w.key, ti: w.ti, tj: w.tj, tile: TILE };
      this.worker.postMessage(req);
    }
    for (const [key, mesh] of this.tiles) {
      const [ti, tj] = key.split(',').map(Number);
      if (this.distanceTo(ti, tj, camera) < DROP) continue;
      if (mesh) {
        mesh.geometry.dispose();
        mesh.removeFromParent();
      }
      this.tiles.delete(key);
    }
  }

  /** True once every tile in reach has come back (for screenshots and tests). */
  get settled() {
    return this.pending.size === 0;
  }

  /** Distance (xz) from the camera to the nearest point of a tile. */
  private distanceTo(ti: number, tj: number, camera: THREE.Vector3) {
    const x0 = -this.half + ti * this.tileSize, z0 = -this.half + tj * this.tileSize;
    const dx = Math.max(x0 - camera.x, 0, camera.x - (x0 + this.tileSize));
    const dz = Math.max(z0 - camera.z, 0, camera.z - (z0 + this.tileSize));
    return Math.hypot(dx, dz);
  }

  private receive(t: CliffTile) {
    this.pending.delete(t.key);
    if (!t.index) {
      this.tiles.set(t.key, null);
      return;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(t.position!, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(t.normal!, 3));
    g.setAttribute('color', new THREE.BufferAttribute(t.color!, 3));
    g.setAttribute('aGrass', new THREE.BufferAttribute(t.grass!, 1));
    g.setAttribute('aSplat', new THREE.BufferAttribute(t.splat!, 4));
    g.setAttribute('aDisp', new THREE.BufferAttribute(t.disp!, 3));
    g.setIndex(new THREE.BufferAttribute(t.index!, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `cliff ${t.key}`;
    this.tiles.set(t.key, mesh);
    this.group.add(mesh);
  }

  get triangles() {
    let n = 0;
    for (const m of this.tiles.values()) if (m) n += m.geometry.index!.count / 3;
    return n;
  }

  dispose() {
    this.worker.terminate();
    for (const m of this.tiles.values()) m?.geometry.dispose();
    this.tiles.clear();
    this.material.dispose();
  }
}
