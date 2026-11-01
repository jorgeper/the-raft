import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import type { HeightFn } from './terrain';
import { addWind } from './wind';

const CHUNK = 24;
const RADIUS = 120;
const BLADES_PER_CHUNK = 9000;
const FULL_DENSITY_DIST = 30;
const GRID = 2; // height sampling step inside a chunk, meters

/** A single tapered, slightly curved blade, 1 unit tall. Normals point up so blades shade like the ground. */
function createBladeGeometry() {
  const segments = 4;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    const halfWidth = 0.045 * (1 - 0.8 * t);
    const lean = 0.22 * t * t;
    positions.push(-halfWidth, t, lean, halfWidth, t, lean);
    const shade = 0.3 + 0.7 * t;
    colors.push(shade, shade, shade, shade, shade, shade);
  }
  positions.push(0, 1, 0.22);
  colors.push(1.05, 1.05, 1);
  for (let i = 0; i < segments - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segments - 1) * 2;
  indices.push(last, last + 1, last + 2);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(positions.length / 3).fill([0, 1, 0]).flat(), 3));
  geo.setIndex(indices);
  return geo;
}

function hashSeed(x: number, z: number) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Grass {
  readonly group = new THREE.Group();
  private chunks = new Map<string, THREE.InstancedMesh>();
  private geometry = createBladeGeometry();
  private material: THREE.MeshPhysicalMaterial;
  private colorNoise = createNoise2D(hashSeed(11, 5));
  private lush = new THREE.Color('#355a14');
  private dry = new THREE.Color('#7d8a32');

  constructor(private height: HeightFn) {
    // No specular: blade normals point up, so grazing views would otherwise mirror the sky as a blue sheen.
    this.material = new THREE.MeshPhysicalMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9, specularIntensity: 0 });
    addWind(
      this.material,
      /* glsl */ `
        float camDist = distance(root.xz, cameraPosition.xz);
        float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, camDist);
        vec3 local = p - root;
        // Shrink into the ground at the edge of the grass radius, and widen distant blades to make up for thinning.
        local.y *= fade;
        local.xz *= 1.0 + camDist / 30.0;
        float bladeHeight = length(instanceMatrix[1].xyz);
        float flex = position.y * position.y * bladeHeight;
        p = root + local + windOffset(root, flex * 0.55) * fade;
      `,
      { uFadeStart: { value: RADIUS * 0.65 }, uFadeEnd: { value: RADIUS } },
    );
  }

  /** Builds or drops chunks around the viewer. `budget` caps new chunks per call to avoid frame hitches. */
  update(viewer: THREE.Vector3, budget = 3) {
    const cx0 = Math.floor(viewer.x / CHUNK), cz0 = Math.floor(viewer.z / CHUNK);
    const span = Math.ceil(RADIUS / CHUNK);
    const wanted: { key: string; cx: number; cz: number; d: number }[] = [];

    for (let cz = cz0 - span; cz <= cz0 + span; cz++) {
      for (let cx = cx0 - span; cx <= cx0 + span; cx++) {
        const d = Math.hypot((cx + 0.5) * CHUNK - viewer.x, (cz + 0.5) * CHUNK - viewer.z);
        if (d < RADIUS + CHUNK * 0.71) wanted.push({ key: `${cx},${cz}`, cx, cz, d });
      }
    }
    wanted.sort((a, b) => a.d - b.d);
    const keep = new Set(wanted.map((w) => w.key));

    for (const [key, mesh] of this.chunks) {
      if (!keep.has(key)) {
        this.group.remove(mesh);
        mesh.dispose();
        this.chunks.delete(key);
      }
    }

    for (const w of wanted) {
      let mesh = this.chunks.get(w.key);
      if (!mesh) {
        if (budget-- <= 0) continue;
        mesh = this.buildChunk(w.cx, w.cz);
        this.chunks.set(w.key, mesh);
        this.group.add(mesh);
      }
      // Blades are stored in random order, so drawing a prefix thins the chunk evenly.
      const t = THREE.MathUtils.clamp((w.d - FULL_DENSITY_DIST) / (RADIUS - FULL_DENSITY_DIST), 0, 1);
      mesh.count = Math.floor(mesh.userData.total * Math.max(0.12, (1 - t) ** 1.6));
    }
  }

  private buildChunk(cx: number, cz: number): THREE.InstancedMesh {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const n = CHUNK / GRID + 1;
    const heights = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = this.height(x0 + i * GRID, z0 + j * GRID);

    const rand = hashSeed(cx, cz);
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, BLADES_PER_CHUNK);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    let placed = 0;

    for (let k = 0; k < BLADES_PER_CHUNK; k++) {
      const lx = rand() * CHUNK, lz = rand() * CHUNK;
      const gx = Math.min(Math.floor(lx / GRID), n - 2), gz = Math.min(Math.floor(lz / GRID), n - 2);
      const fx = lx / GRID - gx, fz = lz / GRID - gz;
      const h00 = heights[gz * n + gx], h10 = heights[gz * n + gx + 1];
      const h01 = heights[(gz + 1) * n + gx], h11 = heights[(gz + 1) * n + gx + 1];
      const h = (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
      const slope = Math.hypot(h10 - h00, h01 - h00) / GRID;

      const x = x0 + lx, z = z0 + lz;
      const dry = 0.5 + 0.5 * this.colorNoise(x * 0.012, z * 0.012);
      // No grass on sand, steep slopes, or in sparse dry patches.
      if (h < 2.4 + rand() * 1.2 || slope > 0.55 + rand() * 0.2) continue;
      if (dry > 0.8 && rand() < (dry - 0.8) * 3) continue;

      const bladeHeight = (0.35 + rand() * 0.55) * (1.15 - 0.4 * dry);
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      s.set(0.8 + rand() * 0.6, bladeHeight, 1);
      p.set(x, h - 0.06, z);
      mesh.setMatrixAt(placed, m.compose(p, q, s));

      c.copy(this.lush).lerp(this.dry, Math.min(dry * dry * 0.8 + rand() * 0.2, 1));
      c.multiplyScalar(0.85 + rand() * 0.3);
      mesh.setColorAt(placed, c);
      placed++;
    }

    mesh.userData.total = placed;
    mesh.count = placed;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    // Bounding sphere ignores wind and widening; pad it so chunks aren't culled early.
    mesh.boundingSphere!.radius += 2;
    return mesh;
  }
}
