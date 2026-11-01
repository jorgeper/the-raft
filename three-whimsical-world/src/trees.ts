import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';
import { createNoise2D } from 'simplex-noise';
import type { HeightFn } from './terrain';
import { TERRAIN_SIZE } from './terrain';
import { addWind } from './wind';

interface Variant {
  preset: string;
  seed: number;
  /** Target height in meters before per-instance scale jitter. */
  height: number;
}

interface BuiltVariant {
  branches: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  barkMaterial: THREE.MeshStandardMaterial;
  leafMaterial: THREE.MeshPhysicalMaterial;
}

// Meadow trees are broadleaf; the inland hills get a pine forest, like Valheim's Black Forest edge.
const MEADOW: Variant[] = [
  { preset: 'Oak Medium', seed: 101, height: 13 },
  { preset: 'Oak Large', seed: 202, height: 17 },
  { preset: 'Ash Medium', seed: 303, height: 14 },
  { preset: 'Aspen Medium', seed: 404, height: 15 },
];
const BUSHES: Variant[] = [
  { preset: 'Bush 1', seed: 505, height: 1.8 },
  { preset: 'Bush 2', seed: 606, height: 2.2 },
];
const FOREST: Variant[] = [
  { preset: 'Pine Medium', seed: 707, height: 18 },
  { preset: 'Pine Large', seed: 808, height: 24 },
];

/** Detail levels: fewer, larger leaves and coarser branches further away keep the silhouette but cut triangles. */
const LODS = [
  { maxDist: 140, leafCount: 1.4, leafSize: 1.15, geo: 1 },
  { maxDist: 420, leafCount: 0.45, leafSize: 1.7, geo: 0.5 },
  { maxDist: Infinity, leafCount: 0.16, leafSize: 2.6, geo: 0.25 },
];

function buildVariant(v: Variant, lod: number): BuiltVariant {
  const tree = new Tree();
  tree.loadPreset(v.preset);
  tree.options.seed = v.seed;
  const o = tree.options, l = LODS[lod];
  o.leaves.count = Math.max(1, Math.round(o.leaves.count * l.leafCount));
  o.leaves.size *= l.leafSize;
  for (const level of Object.keys(o.branch.sections) as unknown as (keyof typeof o.branch.sections)[]) {
    o.branch.sections[level] = Math.max(1, Math.round(o.branch.sections[level] * l.geo));
    o.branch.segments[level] = Math.max(3, Math.round(o.branch.segments[level] * l.geo));
  }
  tree.generate();

  const branches = tree.branchesMesh.geometry;
  const leaves = tree.leavesMesh.geometry;
  branches.computeBoundingBox();
  leaves.computeBoundingBox();
  const top = Math.max(branches.boundingBox!.max.y, leaves.boundingBox!.max.y);
  const scale = v.height / top;
  branches.scale(scale, scale, scale);
  leaves.scale(scale, scale, scale);

  // Point leaf normals away from the crown center so the canopy shades like a volume, not flat cards.
  leaves.computeBoundingBox();
  const center = leaves.boundingBox!.getCenter(new THREE.Vector3());
  const pos = leaves.attributes.position as THREE.BufferAttribute;
  const nrm = leaves.attributes.normal as THREE.BufferAttribute;
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).sub(center);
    n.y = n.y * 0.6 + Math.abs(n.length()) * 0.25;
    n.normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }

  const srcBark = tree.branchesMesh.material as THREE.MeshPhongMaterial;
  const barkMaterial = new THREE.MeshStandardMaterial({
    map: srcBark.map,
    normalMap: srcBark.normalMap,
    color: srcBark.color,
    roughness: 0.95,
  });

  const srcLeaf = tree.leavesMesh.material as THREE.MeshPhongMaterial;
  const leafMaterial = new THREE.MeshPhysicalMaterial({
    specularIntensity: 0.25,
    map: srcLeaf.map,
    // The presets' pale tint washes leaves out under sky light; pull toward a deeper summer green.
    color: srcLeaf.color.clone().multiply(new THREE.Color(0.62, 0.72, 0.5)),
    alphaTest: srcLeaf.alphaTest,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 0.75,
  });
  addWind(
    leafMaterial,
    /* glsl */ `
      float h = max(p.y - root.y, 0.0);
      float flex = h * 0.012;
      vec3 flutter = vec3(sin(uTime * 5.0 + p.x * 2.1), sin(uTime * 4.3 + p.z * 1.7), sin(uTime * 4.7 + p.y * 2.3)) * 0.04;
      p += windOffset(root, flex) + flutter * min(h * 0.2, 1.0) * uWindStrength;
    `,
  );

  return { branches, leaves, barkMaterial, leafMaterial };
}

interface Placement {
  variant: number;
  matrix: THREE.Matrix4;
  center: THREE.Vector3;
  radius: number;
}

export class Trees {
  readonly group = new THREE.Group();
  readonly stats: { preset: string; count: number; tris: number[] }[];
  private placements: Placement[] = [];
  /** meshes[variant][lod] = [branches, leaves] */
  private meshes: [THREE.InstancedMesh, THREE.InstancedMesh][][] = [];
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private sphere = new THREE.Sphere();

  constructor(height: HeightFn, seed = 4242) {
    const all = [...MEADOW, ...BUSHES, ...FOREST];
    const meadowIdx = MEADOW.map((_, i) => i);
    const bushIdx = BUSHES.map((_, i) => MEADOW.length + i);
    const forestIdx = FOREST.map((_, i) => MEADOW.length + BUSHES.length + i);

    let s = seed;
    const rand = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const noise = createNoise2D(rand);
    const pick = (ids: number[]) => ids[Math.floor(rand() * ids.length)];

    const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), sc = new THREE.Vector3();
    const add = (variant: number, x: number, z: number, y: number, scaleJitter: number) => {
      const k = 1 + (rand() - 0.5) * scaleJitter;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      this.placements.push({
        variant,
        matrix: new THREE.Matrix4().compose(p.set(x, y - 0.3, z), q, sc.set(k, k, k)),
        center: new THREE.Vector3(x, y + all[variant].height * k * 0.5, z),
        radius: all[variant].height * k * 0.6,
      });
    };

    const step = 5;
    const half = TERRAIN_SIZE / 2 - 20;
    for (let gz = -half; gz < half; gz += step) {
      for (let gx = -half; gx < half; gx += step) {
        const x = gx + rand() * step, z = gz + rand() * step;
        const y = height(x, z);
        if (y < 3.5) continue;
        const slope = Math.hypot(height(x + 1, z) - y, height(x, z + 1) - y);
        if (slope > 0.6) continue;

        // 0 on the open meadow, 1 deep in the inland forest.
        const forest = THREE.MathUtils.smoothstep(-x, 230, 420) * (0.75 + 0.25 * noise(x * 0.01, z * 0.01));
        // Broadleaf groves come in clumps.
        const grove = THREE.MathUtils.smoothstep(noise(x * 0.0045, z * 0.0045) + 0.25 * noise(x * 0.03, z * 0.03), 0.35, 0.75);

        const r = rand();
        if (r < forest * 0.08) add(pick(forestIdx), x, z, y, 0.5);
        else if (r < forest * 0.08 + grove * 0.22 + 0.0025) add(pick(meadowIdx), x, z, y, 0.45);
        else if (r < forest * 0.08 + grove * 0.32 + 0.004) add(pick(bushIdx), x, z, y, 0.6);
      }
    }

    const counts = all.map((_, vi) => this.placements.filter((pl) => pl.variant === vi).length);
    this.stats = all.map((v, vi) => ({ preset: v.preset, count: counts[vi], tris: [] as number[] }));
    all.forEach((v, vi) => {
      this.meshes[vi] = LODS.map((_, lod) => {
        const b = buildVariant(v, lod);
        this.stats[vi].tris.push(((b.branches.index?.count ?? 0) + (b.leaves.index?.count ?? 0)) / 3);
        const pair = [
          new THREE.InstancedMesh(b.branches, b.barkMaterial, Math.max(counts[vi], 1)),
          new THREE.InstancedMesh(b.leaves, b.leafMaterial, Math.max(counts[vi], 1)),
        ] as [THREE.InstancedMesh, THREE.InstancedMesh];
        for (const mesh of pair) {
          mesh.count = 0;
          // Culling is done per instance in update(), so the whole-world bounds check is skipped.
          mesh.frustumCulled = false;
          mesh.castShadow = lod === 0;
          mesh.receiveShadow = true;
          this.group.add(mesh);
        }
        return pair;
      });
    });
  }

  /** Re-buckets every tree into a detail level by distance, skipping ones outside the (padded) view. */
  update(camera: THREE.Camera) {
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    for (const pair of this.meshes.flat()) pair[0].count = pair[1].count = 0;

    for (const pl of this.placements) {
      this.sphere.center.copy(pl.center);
      // Padding keeps shadow casters just outside the view from popping.
      this.sphere.radius = pl.radius + 25;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const d = pl.center.distanceTo(camera.position);
      const lod = LODS.findIndex((l) => d < l.maxDist);
      const [branches, leaves] = this.meshes[pl.variant][lod];
      branches.setMatrixAt(branches.count, pl.matrix);
      leaves.setMatrixAt(leaves.count, pl.matrix);
      branches.count++;
      leaves.count++;
    }
    for (const [branches, leaves] of this.meshes.flat()) {
      if (branches.count === 0) continue;
      branches.instanceMatrix.clearUpdateRanges();
      branches.instanceMatrix.addUpdateRange(0, branches.count * 16);
      branches.instanceMatrix.needsUpdate = true;
      leaves.instanceMatrix.clearUpdateRanges();
      leaves.instanceMatrix.addUpdateRange(0, leaves.count * 16);
      leaves.instanceMatrix.needsUpdate = true;
    }
  }
}
