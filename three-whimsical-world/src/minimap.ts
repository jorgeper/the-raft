import * as THREE from 'three';
import { TERRAIN_SIZE } from './terrain';
import type { WorldFns } from './worldgen';

const RESOLUTION = 256;

export type Biome = 'Ocean' | 'River' | 'Pond' | 'Beach' | 'Meadows' | 'Black Forest' | 'Mountain';

export function biomeAt(world: WorldFns, x: number, z: number): Biome {
  const h = world.height(x, z);
  if (h < 0) return world.river(x, z) > 0.5 ? 'River' : 'Ocean';
  if (world.pondEdge(x, z) < 0) return 'Pond';
  if (h < 2.5) return 'Beach';
  if (h > 45) return 'Mountain';
  return world.forest(x, z) > 0.5 ? 'Black Forest' : 'Meadows';
}

/** Hill-shaded top-down map of the world, with the player marker. Click to travel. */
export class Minimap {
  readonly element = document.createElement('div');
  private base = document.createElement('canvas');
  private overlay = document.createElement('canvas');
  private label = document.createElement('div');
  private coords = document.createElement('div');
  private world: WorldFns | null = null;
  private lastBiome = '';
  private size = 0;

  /** Called with world (x, z) when the map is clicked. */
  onNavigate: (x: number, z: number) => void = () => {};

  constructor(size: number) {
    this.element.className = 'minimap';
    const frame = document.createElement('div');
    frame.className = 'minimap-frame';
    this.base.width = this.base.height = RESOLUTION;
    frame.append(this.base, this.overlay);
    this.label.className = 'minimap-biome';
    this.coords.className = 'minimap-coords';
    this.element.append(frame, this.label, this.coords);
    this.setSize(size);

    frame.addEventListener('click', (e) => {
      const rect = frame.getBoundingClientRect();
      const u = (e.clientX - rect.left) / rect.width, v = (e.clientY - rect.top) / rect.height;
      this.onNavigate((u - 0.5) * TERRAIN_SIZE, (v - 0.5) * TERRAIN_SIZE);
    });
  }

  setSize(px: number) {
    this.size = px;
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.overlay.width = this.overlay.height = Math.round(px * dpr);
    for (const c of [this.base, this.overlay]) {
      c.style.width = c.style.height = `${px}px`;
    }
    this.element.style.width = `${px}px`;
  }

  setVisible(visible: boolean) {
    this.element.style.display = visible ? '' : 'none';
  }

  /** Renders the terrain into the base layer. Call after each world (re)generation. */
  setWorld(world: WorldFns) {
    this.world = world;
    const n = RESOLUTION, step = TERRAIN_SIZE / n;
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) heights[j * n + i] = world.height((i + 0.5) * step - TERRAIN_SIZE / 2, (j + 0.5) * step - TERRAIN_SIZE / 2);
    }
    const ctx = this.base.getContext('2d')!;
    const image = ctx.createImageData(n, n);
    const deep = new THREE.Color('#26587a'), shallow = new THREE.Color('#3f8c9c'), sand = new THREE.Color('#cdb680');
    const meadow = new THREE.Color('#78a03c'), earth = new THREE.Color('#9a7444'), forest = new THREE.Color('#2b4723');
    const rock = new THREE.Color('#8d8b84'), c = new THREE.Color();
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) * step - TERRAIN_SIZE / 2, z = (j + 0.5) * step - TERRAIN_SIZE / 2;
        const h = heights[j * n + i];
        if (h < 0) {
          c.copy(shallow).lerp(deep, Math.min(-h / 18, 1));
        } else if (world.pondEdge(x, z) < 0) {
          c.copy(shallow);
        } else {
          const f = world.forest(x, z);
          c.copy(meadow).lerp(earth, world.dirt(x, z) * (1 - f) * 0.6).lerp(forest, THREE.MathUtils.smoothstep(f, 0.3, 0.7));
          c.lerp(sand, 1 - THREE.MathUtils.smoothstep(h, 1.5, 3));
          c.lerp(rock, THREE.MathUtils.smoothstep(h, 35, 70));
          // Hill shading, lit from the north-west.
          const hl = heights[j * n + Math.max(i - 1, 0)], hu = heights[Math.max(j - 1, 0) * n + i];
          const shade = THREE.MathUtils.clamp(1 + ((hl - h) + (hu - h)) * 0.06, 0.6, 1.3);
          c.multiplyScalar(shade);
        }
        const k = (j * n + i) * 4;
        image.data[k] = Math.min(255, c.r * 255);
        image.data[k + 1] = Math.min(255, c.g * 255);
        image.data[k + 2] = Math.min(255, c.b * 255);
        image.data[k + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    this.lastBiome = '';
  }

  /** Redraws the player marker and the biome label. */
  update(camera: THREE.Camera, forward: THREE.Vector3) {
    if (!this.world || this.element.style.display === 'none') return;
    const ctx = this.overlay.getContext('2d')!;
    const w = this.overlay.width, scale = w / TERRAIN_SIZE;
    ctx.clearRect(0, 0, w, w);
    const px = (camera.position.x + TERRAIN_SIZE / 2) * scale, py = (camera.position.z + TERRAIN_SIZE / 2) * scale;
    const angle = Math.atan2(forward.z, forward.x);
    const r = w * 0.03;
    // View cone, then the arrow.
    ctx.fillStyle = 'rgba(255, 240, 200, 0.18)';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, w * 0.12, angle - 0.5, angle + 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(r * 1.4, 0);
    ctx.lineTo(-r, r * 0.85);
    ctx.lineTo(-r * 0.45, 0);
    ctx.lineTo(-r, -r * 0.85);
    ctx.closePath();
    ctx.fillStyle = '#fff6dc';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = Math.max(1, w * 0.006);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    const biome = biomeAt(this.world, camera.position.x, camera.position.z);
    if (biome !== this.lastBiome) {
      this.lastBiome = biome;
      this.label.textContent = biome;
    }
    this.coords.textContent = `${Math.round(camera.position.x)}, ${Math.round(camera.position.z)}`;
  }
}
