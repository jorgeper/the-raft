import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';
import { createNoise2D } from 'simplex-noise';
import { TERRAIN_SIZE } from './terrain';
import type { WorldFns } from './worldgen';
import { addWind, sunLight } from './wind';
import { bakeImpostor, createImpostorMesh, textureReady } from './impostor';

type TreeOptions = Tree['options'];

interface Variant {
  preset: string;
  seed: number;
  /** Target height in meters before per-instance scale jitter. */
  height: number;
  /** Edits applied on top of the preset to get a Valheim-like silhouette. */
  tweak?: (o: TreeOptions) => void;
}

interface BuiltVariant {
  branches: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  barkMaterial: THREE.MeshStandardMaterial;
  leafMaterial: THREE.MeshPhysicalMaterial;
}

// Valheim meadow trees: tall beech with dense rounded crowns, broad oaks, and birch.
const beech = (o: TreeOptions) => {
  o.branch.gnarliness = { 0: 0, 1: 0.08, 2: 0.06, 3: 0.08 };
  o.branch.children = { 0: 11, 1: 5, 2: 4 };
  o.branch.angle = { 1: 42, 2: 40, 3: 34 };
  o.branch.start = { 1: 0.42, 2: 0.1, 3: 0 };
  o.leaves.count = 26;
  o.leaves.size = 5.2;
  o.leaves.start = 0;
  o.leaves.angle = 30;
};
const oak = (o: TreeOptions) => {
  o.branch.children = { 0: 10, 1: 5, 2: 4 };
  o.branch.angle = { 1: 62, 2: 45, 3: 35 };
  o.branch.start = { 1: 0.3, 2: 0.08, 3: 0 };
  o.leaves.count = 24;
  o.leaves.size = 6;
  o.leaves.start = 0;
};
const birch = (o: TreeOptions) => {
  o.bark.type = 'birch';
  o.leaves.count = Math.round(o.leaves.count * 2.2);
  o.leaves.size *= 1.25;
  o.leaves.start = 0;
};
const MEADOW: Variant[] = [
  { preset: 'Ash Large', seed: 101, height: 22, tweak: beech },
  { preset: 'Ash Large', seed: 131, height: 19, tweak: beech },
  { preset: 'Oak Large', seed: 202, height: 16, tweak: oak },
  { preset: 'Aspen Large', seed: 404, height: 17, tweak: birch },
];
const BUSHES: Variant[] = [
  { preset: 'Bush 1', seed: 505, height: 1.8 },
  { preset: 'Bush 2', seed: 606, height: 2.2 },
];
// Forest biome: tall Black Forest spruce with thick, bare lower trunks and dense layered boughs.
const spruce = (o: TreeOptions) => {
  o.branch.start = { ...o.branch.start, 1: 0.34 };
  o.branch.radius = { ...o.branch.radius, 0: o.branch.radius[0] * 1.35 };
  o.branch.gnarliness = { ...o.branch.gnarliness, 0: 0.02 };
  o.leaves.count = Math.round(o.leaves.count * 1.5);
  o.leaves.size *= 1.25;
};
// Young spruce dotting the forest floor and its edges.
const SAPLINGS: Variant[] = [
  { preset: 'Pine Small', seed: 1001, height: 3.5, tweak: spruce },
  { preset: 'Pine Small', seed: 1002, height: 5.5, tweak: spruce },
];
const FOREST: Variant[] = [
  { preset: 'Pine Medium', seed: 707, height: 24, tweak: spruce },
  { preset: 'Pine Large', seed: 808, height: 31, tweak: spruce },
  { preset: 'Pine Large', seed: 919, height: 27, tweak: spruce },
];

/**
 * Geometry detail levels: fewer, larger leaves and coarser branches further away keep the silhouette but cut
 * triangles. Past the last one, trees are drawn as baked impostor quads.
 */
const LODS = [
  { maxDist: 100, leafCount: 1, leafSize: 1, geo: 1 },
  { maxDist: 240, leafCount: 0.5, leafSize: 1.6, geo: 0.5 },
];

// Tree geometry and impostors depend only on the species, so they're built once and reused across worlds.
const variantCache = new Map<string, BuiltVariant>();
const impostorCache = new Map<string, ReturnType<typeof bakeImpostor>>();
const variantKey = (v: Variant, lod: number) => `${v.preset}|${v.seed}|${lod}`;
function getVariant(v: Variant, lod: number) {
  const key = variantKey(v, lod);
  let built = variantCache.get(key);
  if (!built) variantCache.set(key, (built = buildVariant(v, lod)));
  return built;
}

function buildVariant(v: Variant, lod: number): BuiltVariant {
  const tree = new Tree();
  tree.loadPreset(v.preset);
  tree.options.seed = v.seed;
  v.tweak?.(tree.options);
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

  // Point leaf normals away from the crown center so the canopy shades like a volume, not flat cards,
  // and darken leaves deep inside and low in the crown (cheap ambient occlusion).
  leaves.computeBoundingBox();
  const box = leaves.boundingBox!;
  const center = box.getCenter(new THREE.Vector3());
  const halfSize = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const pos = leaves.attributes.position as THREE.BufferAttribute;
  const nrm = leaves.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(pos, i).sub(center);
    const shell = Math.min(Math.hypot(n.x / halfSize.x, n.y / halfSize.y, n.z / halfSize.z), 1);
    const heightFrac = (pos.getY(i) - box.min.y) / (2 * halfSize.y);
    const ao = (0.3 + 0.7 * THREE.MathUtils.smoothstep(shell, 0.25, 0.95)) * (0.7 + 0.3 * heightFrac);
    colors.set([ao, ao, ao], i * 3);
    n.y = n.y * 0.6 + Math.abs(n.length()) * 0.25;
    n.normalize();
    nrm.setXYZ(i, n.x, n.y, n.z);
  }
  leaves.setAttribute('color', new THREE.BufferAttribute(colors, 3));

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
    vertexColors: true,
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
  // Leaves glow when backlit, but only on the sunlit outer shell (vertex AO stands in for depth in the crown).
  const patchVertex = leafMaterial.onBeforeCompile;
  leafMaterial.onBeforeCompile = (shader, renderer) => {
    patchVertex.call(leafMaterial, shader, renderer);
    Object.assign(shader.uniforms, sunLight);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunDirView;\nuniform vec3 uSunColor;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float backlit = pow(max(dot(normalize(-vViewPosition), uSunDirView), 0.0), 4.0);
        float shellLight = smoothstep(0.55, 1.0, vColor.r);
        totalEmissiveRadiance += uSunColor * diffuseColor.rgb * vec3(1.0, 1.2, 0.55) * backlit * shellLight * 0.9;`,
      )
      // Vertex AO only darkens diffuse; occlude reflections too, or the crown interior glows grey with sky light.
      .replace(
        '#include <aomap_fragment>',
        '#include <aomap_fragment>\nreflectedLight.indirectSpecular *= vColor.r * vColor.r;\nreflectedLight.directSpecular *= vColor.r;',
      );
  };

  return { branches, leaves, barkMaterial, leafMaterial };
}

interface Placement {
  variant: number;
  matrix: THREE.Matrix4;
  center: THREE.Vector3;
  radius: number;
  /** Per-tree leaf tint so neighbors aren't identical. */
  color: THREE.Color;
}

export class Trees {
  readonly group = new THREE.Group();
  readonly stats: { preset: string; count: number; tris: number[] }[];
  private placements: Placement[] = [];
  /** meshes[variant][lod] = [branches, leaves] */
  private meshes: [THREE.InstancedMesh, THREE.InstancedMesh][][] = [];
  /** impostors[variant]; empty until the bark/leaf textures have loaded and been baked. */
  private impostors: THREE.InstancedMesh[] = [];
  private counts: number[] = [];
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private sphere = new THREE.Sphere();

  private all = [...MEADOW, ...BUSHES, ...FOREST, ...SAPLINGS];

  constructor(world: WorldFns, private renderer: THREE.WebGLRenderer) {
    const { height, params } = world;
    const seed = params.seed * 7 + 4242;
    const all = this.all;
    const meadowIdx = MEADOW.map((_, i) => i);
    const bushIdx = BUSHES.map((_, i) => MEADOW.length + i);
    const forestIdx = FOREST.map((_, i) => MEADOW.length + BUSHES.length + i);
    const saplingIdx = SAPLINGS.map((_, i) => MEADOW.length + BUSHES.length + FOREST.length + i);

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
        color: new THREE.Color().setRGB(0.85 + rand() * 0.25, 0.88 + rand() * 0.22, 0.8 + rand() * 0.2),
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

        if (world.river(x, z) > 0.2) continue;
        // 0 on the open meadow, 1 deep in a forest.
        const forest = world.forest(x, z);
        // Broadleaf groves come in clumps on the meadow; a few lone trees anywhere.
        const grove =
          THREE.MathUtils.smoothstep(noise(x * 0.0045, z * 0.0045) + 0.25 * noise(x * 0.03, z * 0.03), 0.35, 0.75) * params.groves;

        // ~one spruce per 110 m² deep in the forest, with broadleaf and bushes mixed in at its edge.
        const pSpruce = forest * 0.22;
        const pBroadleaf = (1 - forest) * (grove * 0.28 + 0.003 * params.groves) + forest * (1 - forest) * 0.15;
        const pBush = (1 - forest) * (grove * 0.12 + 0.002) + forest * 0.02;
        // Saplings crowd the forest edge, where there's more light.
        const pSapling = forest * 0.06 + forest * (1 - forest) * 0.3;
        let r = rand();
        if (r < pSpruce) add(pick(forestIdx), x, z, y, 0.45);
        else if ((r -= pSpruce) < pBroadleaf) add(pick(meadowIdx), x, z, y, 0.7);
        else if ((r -= pBroadleaf) < pBush) add(pick(bushIdx), x, z, y, 0.6);
        else if ((r -= pBush) < pSapling) add(pick(saplingIdx), x, z, y, 0.6);
      }
    }

    const counts = (this.counts = all.map((_, vi) => this.placements.filter((pl) => pl.variant === vi).length));
    this.stats = all.map((v, vi) => ({ preset: v.preset, count: counts[vi], tris: [] as number[] }));
    all.forEach((v, vi) => {
      this.meshes[vi] = LODS.map((_, lod) => {
        const b = getVariant(v, lod);
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

  /** Bakes one impostor per species from its mid detail level, once textures are available. */
  private tryBakeImpostors() {
    const mid = this.meshes.map((lods) => lods[LODS.length - 1]);
    const materials = mid.flatMap(([b, l]) => [b.material, l.material] as THREE.MeshStandardMaterial[]);
    if (!materials.every(textureReady)) return;
    this.impostors = mid.map(([branches, leaves], vi) => {
      const key = variantKey(this.all[vi], LODS.length - 1);
      let impostor = impostorCache.get(key);
      if (!impostor) {
        impostor = bakeImpostor(
          this.renderer,
          branches.geometry,
          leaves.geometry,
          branches.material as THREE.MeshStandardMaterial,
          leaves.material as THREE.MeshStandardMaterial,
        );
        impostorCache.set(key, impostor);
      }
      const mesh = createImpostorMesh(impostor, this.counts[vi]);
      this.group.add(mesh);
      return mesh;
    });
  }

  /** Frees this world's instance buffers; species geometry and impostors stay cached for the next world. */
  dispose() {
    for (const mesh of this.group.children as THREE.InstancedMesh[]) mesh.dispose();
    for (const mesh of this.impostors) (mesh.material as THREE.Material).dispose();
    this.group.clear();
  }

  /** Re-buckets every tree into a detail level by distance, skipping ones outside the (padded) view. */
  update(camera: THREE.Camera) {
    if (this.impostors.length === 0) this.tryBakeImpostors();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    for (const pair of this.meshes.flat()) pair[0].count = pair[1].count = 0;
    for (const mesh of this.impostors) mesh.count = 0;

    for (const pl of this.placements) {
      this.sphere.center.copy(pl.center);
      // Padding keeps shadow casters just outside the view from popping.
      this.sphere.radius = pl.radius + 25;
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      const d = pl.center.distanceTo(camera.position);
      const impostor = this.impostors[pl.variant];
      if (d >= LODS[LODS.length - 1].maxDist && impostor) {
        impostor.setMatrixAt(impostor.count, pl.matrix);
        impostor.setColorAt(impostor.count, pl.color);
        impostor.count++;
        continue;
      }
      let lod = LODS.findIndex((l) => d < l.maxDist);
      // Beyond the last level but impostors aren't baked yet: use the coarsest geometry.
      if (lod === -1) lod = LODS.length - 1;
      const [branches, leaves] = this.meshes[pl.variant][lod];
      branches.setMatrixAt(branches.count, pl.matrix);
      leaves.setMatrixAt(leaves.count, pl.matrix);
      leaves.setColorAt(leaves.count, pl.color);
      branches.count++;
      leaves.count++;
    }
    for (const mesh of this.impostors) {
      if (mesh.count === 0) continue;
      mesh.instanceMatrix.clearUpdateRanges();
      mesh.instanceMatrix.addUpdateRange(0, mesh.count * 16);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.clearUpdateRanges();
      mesh.instanceColor!.addUpdateRange(0, mesh.count * 3);
      mesh.instanceColor!.needsUpdate = true;
    }
    for (const [branches, leaves] of this.meshes.flat()) {
      if (branches.count === 0) continue;
      branches.instanceMatrix.clearUpdateRanges();
      branches.instanceMatrix.addUpdateRange(0, branches.count * 16);
      branches.instanceMatrix.needsUpdate = true;
      leaves.instanceMatrix.clearUpdateRanges();
      leaves.instanceMatrix.addUpdateRange(0, leaves.count * 16);
      leaves.instanceMatrix.needsUpdate = true;
      if (leaves.instanceColor) {
        leaves.instanceColor.clearUpdateRanges();
        leaves.instanceColor.addUpdateRange(0, leaves.count * 3);
        leaves.instanceColor.needsUpdate = true;
      }
    }
  }
}
