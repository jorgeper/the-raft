import * as THREE from 'three';
import { weatherUniforms } from './weather';
import { Tree } from '@dgreenheck/ez-tree';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise2D } from 'simplex-noise';
import { TERRAIN_SIZE } from './terrain';
import type { WorldFns } from './worldgen';
import { addWind, sunLight } from './wind';
import { AUTUMN_LEAVES, BARE_DECLS, BARE_FRAGMENT, BARE_VERTEX, bakeImpostor, createImpostorMesh, textureReady } from './impostor';
import { seasonUniforms, type Season } from './season';
import { FAR_CASTERS } from './cascades';
import { quality } from './quality';

type TreeOptions = Tree['options'];

interface Variant {
  preset: string;
  seed: number;
  /** Target height in meters before per-instance scale jitter. */
  height: number;
  /** Edits applied on top of the preset to get a Valheim-like silhouette. */
  tweak?: (o: TreeOptions) => void;
  /** Leaf color multiplier, for species told apart by foliage color. */
  tint?: string;
  /** Clusters of berries among the outer leaves (rowan), in this color. */
  berries?: string;
  /** Evergreen (needles): keeps its color all year. */
  needles?: boolean;
}

/** How a species' leaves go through the year. */
type LeafKind = 'needles' | 'aspen' | 'ash' | 'oak' | 'rowan' | 'bush';
function leafKind(v: Variant): LeafKind {
  if (v.needles || v.preset.startsWith('Pine')) return 'needles';
  if (v.berries) return 'rowan';
  if (v.preset.startsWith('Aspen')) return 'aspen';
  if (v.preset.startsWith('Oak')) return 'oak';
  if (v.preset.startsWith('Ash')) return 'ash';
  return 'bush';
}
/** How bare a species gets in winter (oaks hold on to some withered leaves; evergreens none). */
const BARE: Record<LeafKind, number> = { needles: 0, aspen: 0.95, ash: 0.95, rowan: 0.92, oak: 0.72, bush: 0.85 };

interface BuiltVariant {
  branches: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  barkMaterial: THREE.MeshStandardMaterial;
  leafMaterial: THREE.MeshPhysicalMaterial;
  /** Casts the leaves' shadows with the crown's sway, so sun flecks drift on the ground beneath. */
  leafDepth: THREE.MeshDepthMaterial;
  /** Berry clusters (rowan), only on the nearer detail levels. */
  berries?: THREE.BufferGeometry;
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
// Rowan: a slim tree with feathery ash-like leaves and clusters of scarlet berries, at forest edges and alone on
// the meadow.
const rowan = (o: TreeOptions) => {
  o.branch.children = { 0: 7, 1: 4, 2: 3 };
  o.branch.angle = { 1: 38, 2: 38, 3: 32 };
  o.branch.start = { 1: 0.35, 2: 0.1, 3: 0 };
  o.leaves.count = Math.round(o.leaves.count * 1.1);
  o.leaves.start = 0;
};
const MEADOW: Variant[] = [
  { preset: 'Ash Large', seed: 101, height: 22, tweak: beech },
  { preset: 'Ash Large', seed: 131, height: 19, tweak: beech },
  { preset: 'Ash Large', seed: 151, height: 25, tweak: beech, tint: '#e8ffd0' },
  { preset: 'Oak Large', seed: 202, height: 16, tweak: oak },
  { preset: 'Oak Large', seed: 222, height: 13, tweak: oak, tint: '#fff0c8' },
  { preset: 'Aspen Large', seed: 404, height: 17, tweak: birch },
];
// Young broadleaf trees: scattered singly on the meadow and crowding grove and forest edges.
const SMALL_TREES: Variant[] = [
  { preset: 'Oak Small', seed: 1201, height: 6.5, tweak: oak },
  { preset: 'Ash Small', seed: 1202, height: 8, tweak: beech },
  { preset: 'Aspen Small', seed: 1203, height: 9, tweak: birch },
  { preset: 'Aspen Medium', seed: 1204, height: 12, tweak: birch, tint: '#fff4b0' },
  { preset: 'Ash Small', seed: 1301, height: 7, tweak: rowan, tint: '#e6ffc0', berries: '#d8200c' },
  { preset: 'Ash Medium', seed: 1302, height: 9.5, tweak: rowan, tint: '#f0ffd0', berries: '#e2340e' },
];
const bushLeaves = (type: string, count = 1.3, size = 1.1) => (o: TreeOptions) => {
  o.leaves.type = type;
  o.leaves.count = Math.round(o.leaves.count * count);
  o.leaves.size *= size;
};
// Meadow undergrowth: hazel-like, raspberry (reddish), elder (dark), and a low wide shrub.
const MEADOW_BUSHES: Variant[] = [
  { preset: 'Bush 1', seed: 505, height: 1.8 },
  { preset: 'Bush 2', seed: 606, height: 2.2 },
  { preset: 'Bush 3', seed: 707, height: 2.8 },
  { preset: 'Bush 1', seed: 515, height: 1.2, tweak: bushLeaves('aspen', 1.5), tint: '#ffb0a0' },
  { preset: 'Bush 2', seed: 616, height: 1.5, tweak: bushLeaves('oak', 1.4, 1.2), tint: '#a8c890' },
];
// Forest undergrowth: juniper-like evergreen shrubs.
const FOREST_BUSHES: Variant[] = [
  { preset: 'Bush 3', seed: 717, height: 1.6, tweak: bushLeaves('pine', 2, 1.4), needles: true },
  { preset: 'Bush 1', seed: 727, height: 1.1, tweak: bushLeaves('pine', 2.2, 1.3), tint: '#c0d8a8', needles: true },
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
  { preset: 'Pine Medium', seed: 1111, height: 18, tweak: spruce },
  { preset: 'Pine Large', seed: 808, height: 31, tweak: spruce },
  { preset: 'Pine Large', seed: 919, height: 27, tweak: spruce },
  // Old giants towering over the canopy.
  { preset: 'Pine Large', seed: 1010, height: 38, tweak: spruce, tint: '#d8e8c8' },
];

// Lone giant oaks on hilltops (worldgen 'oak' landmarks): a thick, gnarled trunk under a vast, low-spreading crown.
const giantOak = (o: TreeOptions) => {
  oak(o);
  o.branch.children = { 0: 9, 1: 6, 2: 4 };
  o.branch.angle = { 1: 82, 2: 52, 3: 40 };
  o.branch.start = { 1: 0.2, 2: 0.05, 3: 0 };
  // Long, heavy limbs reaching out sideways: a crown wider than the tree is tall.
  o.branch.length = { ...o.branch.length, 1: o.branch.length[1] * 1.35 };
  o.branch.radius = { ...o.branch.radius, 0: o.branch.radius[0] * 1.9 };
  o.branch.gnarliness = { 0: 0.06, 1: 0.18, 2: 0.14, 3: 0.1 };
  o.leaves.count = 30;
  o.leaves.size = 6.5;
};
const GIANTS: Variant[] = [{ preset: 'Oak Large', seed: 4441, height: 24, tweak: giantOak, tint: '#f4ffd8' }];

/**
 * Geometry detail levels: fewer, larger leaves and coarser branches further away keep the silhouette but cut
 * triangles. Past the last one, trees are drawn as baked impostor quads.
 */
const LODS = [
  { maxDist: 75, leafCount: 1, leafSize: 1, geo: 1 },
  { maxDist: 140, leafCount: 0.5, leafSize: 1.6, geo: 0.5 },
  // 140-240 m: a tree is a few dozen pixels tall; a fifth of the leaves (bigger) keeps the crown's outline.
  { maxDist: 240, leafCount: 0.2, leafSize: 2.5, geo: 0.34 },
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
  // Rain soaks the bark: darker, with a dull sheen. Snow lines the tops of the limbs.
  barkMaterial.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uWet: weatherUniforms.uWet, uSnow: weatherUniforms.uSnow });
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWet;\nuniform float uSnow;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - 0.45 * uWet;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.45, uWet);')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (uSnow > 0.0) {
          float upB = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
          float lined = smoothstep(0.55, 0.85, upB) * min(uSnow * 1.5, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.91, 0.96), lined);
        }`,
      );
  };
  barkMaterial.customProgramCacheKey = () => 'tree-bark-wet';

  const srcLeaf = tree.leavesMesh.material as THREE.MeshPhongMaterial;
  const leafMaterial = new THREE.MeshPhysicalMaterial({
    specularIntensity: 0.25,
    map: srcLeaf.map,
    // The presets' pale tint washes leaves out under sky light; pull toward a deeper summer green.
    color: srcLeaf.color.clone().multiply(new THREE.Color(0.62, 0.72, 0.5)).multiply(new THREE.Color(v.tint ?? '#ffffff')),
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
  // The shadow follows the crown's slow sway, not the leaf flutter: dapples drift gently instead of shimmering.
  const leafDepth = new THREE.MeshDepthMaterial();
  addWind(
    leafDepth,
    /* glsl */ `
      float h = max(p.y - root.y, 0.0);
      p += windOffset(root, h * 0.012);
    `,
  );
  leafDepth.customProgramCacheKey = () => 'tree-leaf-depth';
  // Broadleaf species shed their leaves through autumn into winter (src/season.ts), shadows and all.
  const bareK = BARE[leafKind(v)];
  if (bareK > 0) {
    leafMaterial.defines = { ...leafMaterial.defines, BARE_K: bareK.toFixed(2) };
    leafDepth.defines = { ...leafDepth.defines, BARE_K: bareK.toFixed(2) };
    const depthWind = leafDepth.onBeforeCompile;
    leafDepth.onBeforeCompile = (shader, renderer) => {
      depthWind.call(leafDepth, shader, renderer);
      shader.uniforms.uBare = seasonUniforms.uBare;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${BARE_DECLS}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${BARE_VERTEX}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${BARE_DECLS}`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${BARE_FRAGMENT}`);
    };
  }
  // Leaves glow when backlit, but only on the sunlit outer shell (vertex AO stands in for depth in the crown).
  const patchVertex = leafMaterial.onBeforeCompile;
  leafMaterial.onBeforeCompile = (shader, renderer) => {
    patchVertex.call(leafMaterial, shader, renderer);
    Object.assign(shader.uniforms, sunLight, { uSnow: weatherUniforms.uSnow }, seasonUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${BARE_DECLS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${BARE_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${BARE_DECLS}`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${BARE_FRAGMENT}`)
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunDirView;\nuniform vec3 uSunColor;\nuniform float uSnow;')
      // Snow on the crown's outer shell, on leaves lying flat enough to hold it.
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (uSnow > 0.0) {
          float upL = abs(dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz)));
          float held = smoothstep(0.2, 0.6, upL) * smoothstep(0.25, 0.7, vColor.r) * min(uSnow * 1.4, 1.0);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.96), held);
        }`,
      )
      .replace('#include <common>', `#include <common>\n${AUTUMN_LEAVES}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // (USE_COLOR, not USE_INSTANCING_COLOR: three defines that one only in the vertex shader.)
        #ifdef USE_COLOR
          // Autumn trees (see the placement): vColor is the instance color times the vertex AO (grey).
          diffuseColor.rgb = autumnLeaves(diffuseColor.rgb, vColor.rgb, 1.0);
        #endif`,
      )
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

  const berries = v.berries && lod < 2 ? buildBerries(leaves, center, halfSize, v.seed, new THREE.Color(v.berries)) : undefined;
  return { branches, leaves, barkMaterial, leafMaterial, leafDepth, berries };
}

/**
 * Hanging clusters of berries on the crown's outer shell: a handful of small octahedra per cluster, each a little
 * different in shade, placed just under randomly chosen outer leaves. Exaggerated in size so they read from afar.
 */
function buildBerries(leaves: THREE.BufferGeometry, center: THREE.Vector3, halfSize: THREE.Vector3, seed: number, color: THREE.Color) {
  let s = seed * 9973;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const pos = leaves.attributes.position as THREE.BufferAttribute;
  const berry = new THREE.OctahedronGeometry(0.045, 0);
  const parts: THREE.BufferGeometry[] = [];
  const v = new THREE.Vector3(), d = new THREE.Vector3(), c = new THREE.Color();
  const clusters = THREE.MathUtils.clamp(Math.round(pos.count / 40), 24, 90);
  for (let k = 0, tries = 0; k < clusters && tries < clusters * 20; tries++) {
    v.fromBufferAttribute(pos, Math.floor(rand() * pos.count));
    d.copy(v).sub(center);
    // Outer shell and upper two thirds of the crown, where the light reaches.
    if (Math.hypot(d.x / halfSize.x, d.y / halfSize.y, d.z / halfSize.z) < 0.7 || d.y < -0.4 * halfSize.y) continue;
    k++;
    const count = 6 + Math.floor(rand() * 5);
    for (let i = 0; i < count; i++) {
      const b = berry.clone();
      const a = rand() * Math.PI * 2, r = rand() * 0.11;
      b.scale(0.8 + rand() * 0.4, 0.8 + rand() * 0.4, 0.8 + rand() * 0.4);
      b.translate(v.x + Math.cos(a) * r, v.y - 0.12 - rand() * 0.12, v.z + Math.sin(a) * r);
      c.copy(color).multiplyScalar(0.75 + rand() * 0.35);
      const cols = new Float32Array(b.attributes.position.count * 3);
      for (let j = 0; j < cols.length; j += 3) cols.set([c.r, c.g, c.b], j);
      b.setAttribute('color', new THREE.BufferAttribute(cols, 3));
      parts.push(b);
    }
  }
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  berry.dispose();
  return merged;
}

/** Glossy berries that sway with the crown (the same slow sway the leaves' shadows use). */
const berryMaterial = (() => {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0 });
  addWind(
    m,
    /* glsl */ `
      float h = max(p.y - root.y, 0.0);
      p += windOffset(root, h * 0.012);
    `,
  );
  return m;
})();

interface Placement {
  variant: number;
  matrix: THREE.Matrix4;
  center: THREE.Vector3;
  radius: number;
  /** Per-tree leaf tint so neighbors aren't identical (and marks for autumn and blossom; see autumnLeaves). */
  color: THREE.Color;
  /** The tree's own tint, and its color in summer (a few turning early, in drifts). */
  natural: THREE.Color;
  summer: THREE.Color;
}

export class Trees {
  readonly group = new THREE.Group();
  readonly stats: { preset: string; count: number; tris: number[] }[];
  private placements: Placement[] = [];
  /** meshes[variant][lod] = [branches, leaves] */
  private meshes: [THREE.InstancedMesh, THREE.InstancedMesh][][] = [];
  /** berries[variant][lod], for species that bear them (rowan) at the nearer levels. */
  private berries: (THREE.InstancedMesh | null)[][] = [];
  private fruiting = true;
  /** impostors[variant]; empty until the bark/leaf textures have loaded and been baked. */
  private impostors: THREE.InstancedMesh[] = [];
  private counts: number[] = [];
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private sphere = new THREE.Sphere();

  private all = [...MEADOW, ...SMALL_TREES, ...MEADOW_BUSHES, ...FOREST_BUSHES, ...FOREST, ...SAPLINGS, ...GIANTS];

  constructor(world: WorldFns, private renderer: THREE.WebGLRenderer) {
    const { height, params } = world;
    const seed = params.seed * 7 + 4242;
    const all = this.all;
    // Index ranges of each group inside `all`.
    let offset = 0;
    const range = (group: Variant[]) => {
      const ids = group.map((_, i) => offset + i);
      offset += group.length;
      return ids;
    };
    const meadowIdx = range(MEADOW);
    const smallIdx = range(SMALL_TREES);
    const meadowBushIdx = range(MEADOW_BUSHES);
    const forestBushIdx = range(FOREST_BUSHES);
    const forestIdx = range(FOREST);
    const saplingIdx = range(SAPLINGS);
    const giantIdx = range(GIANTS);

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
        natural: new THREE.Color(),
        summer: new THREE.Color(),
      });
      const placed = this.placements[this.placements.length - 1];
      placed.natural.copy(placed.color);
      // A first touch of autumn, in drifts: birches turning gold, young broadleaf and the odd big tree copper-red.
      // The leaf shader reads a low blue/red ratio in the instance color as "autumn" and its green/red as the hue.
      const preset = all[variant].preset;
      const kind = preset.startsWith('Aspen') ? 0.55 : /Small|Medium/.test(preset) && !preset.startsWith('Pine') ? 0.3 : /Ash|Oak/.test(preset) ? 0.08 : 0;
      if (kind > 0) {
        const drift = THREE.MathUtils.smoothstep(noise(x * 0.008 + 41, z * 0.008 - 17), -0.2, 0.5);
        const h = (Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
        if (Math.abs(h) < kind * drift) {
          const gold = preset.startsWith('Aspen') ? 1 : 0.55 + Math.abs((h * 7.3) % 1) * 0.25;
          this.placements[this.placements.length - 1].color.setRGB(1, gold, 0.3);
        }
      }
      placed.summer.copy(placed.color);
      // Landmarks keep their ground open. Dropped after the draws, so the rest of the forest stays where it was.
      if (world.clearing(x, z) > 0.5) this.placements.pop();
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

        if (world.river(x, z) > 0.2 || world.pondEdge(x, z) < 3) continue;
        // 0 on the open meadow, 1 deep in a forest.
        const forest = world.forest(x, z);
        // Broadleaf groves come in clumps on the meadow; a few lone trees anywhere.
        const grove =
          THREE.MathUtils.smoothstep(noise(x * 0.0045, z * 0.0045) + 0.25 * noise(x * 0.03, z * 0.03), 0.35, 0.75) * params.groves;

        // ~one spruce per 110 m² deep in the forest, with broadleaf and bushes mixed in at its edge.
        const edge = forest * (1 - forest);
        const pSpruce = forest * 0.22 * params.bigTrees;
        const pBroadleaf = ((1 - forest) * (grove * 0.28 + 0.003 * params.groves) + edge * 0.15) * params.bigTrees;
        // Young trees ring the groves and forest edges, with a few loners in the open.
        const pSmall = ((1 - forest) * (grove * 0.14 + 0.003) + edge * 0.25) * params.smallTrees;
        // Bushes cluster around groves and line the forest edge; juniper fills the forest floor.
        const pMeadowBush = ((1 - forest) * (grove * 0.2 + 0.006) + edge * 0.35) * params.bushes;
        const pForestBush = forest * 0.05 * params.bushes;
        // Saplings crowd the forest edge, where there's more light.
        const pSapling = (forest * 0.06 + edge * 0.3) * params.smallTrees;
        let r = rand();
        if (r < pSpruce) add(pick(forestIdx), x, z, y, 0.45);
        else if ((r -= pSpruce) < pBroadleaf) add(pick(meadowIdx), x, z, y, 0.7);
        else if ((r -= pBroadleaf) < pSmall) add(pick(smallIdx), x, z, y, 0.6);
        else if ((r -= pSmall) < pMeadowBush) add(pick(meadowBushIdx), x, z, y, 0.7);
        else if ((r -= pMeadowBush) < pForestBush) add(pick(forestBushIdx), x, z, y, 0.6);
        else if ((r -= pForestBush) < pSapling) add(pick(saplingIdx), x, z, y, 0.6);
      }
    }

    // The giant oaks stand in their own clearings (which keep every other tree away).
    for (const l of world.landmarks) {
      if (l.kind !== 'oak') continue;
      const v = all[giantIdx[0]];
      q.setFromAxisAngle(up, l.yaw);
      const y = height(l.x, l.z);
      this.placements.push({
        variant: giantIdx[0],
        matrix: new THREE.Matrix4().compose(p.set(l.x, y - 0.5, l.z), q, sc.set(1, 1, 1)),
        center: new THREE.Vector3(l.x, y + v.height * 0.5, l.z),
        radius: v.height * 0.7,
        color: new THREE.Color(0.95, 1, 0.92),
        natural: new THREE.Color(0.95, 1, 0.92),
        summer: new THREE.Color(0.95, 1, 0.92),
      });
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
        pair[1].customDepthMaterial = b.leafDepth;
        (this.berries[vi] ??= [])[lod] = null;
        if (b.berries) {
          const bm = new THREE.InstancedMesh(b.berries, berryMaterial, Math.max(counts[vi], 1));
          bm.count = 0;
          bm.frustumCulled = false;
          bm.receiveShadow = true;
          this.group.add(bm);
          this.berries[vi][lod] = bm;
        }
        for (const mesh of pair) {
          mesh.count = 0;
          // Culling is done per instance in update(), so the whole-world bounds check is skipped.
          mesh.frustumCulled = false;
          // Full-detail trees shadow both cascades; coarser ones only the far map (see FAR_CASTERS).
          mesh.castShadow = true;
          if (lod > 0) mesh.layers.set(FAR_CASTERS);
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
      const mesh = createImpostorMesh(impostor, this.counts[vi], BARE[leafKind(this.all[vi])]);
      mesh.castShadow = true;
      mesh.layers.set(FAR_CASTERS);
      this.group.add(mesh);
      return mesh;
    });
  }

  /**
   * Marks each tree for the season (the leaf shaders read the marks, see autumnLeaves): spring blossom on many bushes
   * and a share of the ash, aspen and rowan; in autumn every broadleaf tree turned (a few late ones still green); in winter all of
   * them, withered (src/season.ts). Evergreens keep their color. The instance colors refresh on the next update.
   */
  setSeason(season: Season) {
    // Rowans flower in spring; the berries ripen by late summer and hang on into winter.
    this.fruiting = season !== 'spring';
    for (const pl of this.placements) {
      const v = this.all[pl.variant];
      const kind = leafKind(v);
      const h = Math.abs(Math.sin(pl.center.x * 12.9898 + pl.center.z * 78.233) * 43758.5453) % 1;
      if (kind === 'needles' || season === 'summer') {
        pl.color.copy(pl.summer);
      } else if (season === 'spring') {
        pl.color.copy(pl.natural);
        // Blossom: hawthorn and blackthorn among the bushes, wild cherry-like among the slimmer trees; oaks leaf out.
        const share = kind === 'bush' ? 0.45 : kind === 'oak' ? 0 : /Small|Medium/.test(v.preset) ? 0.4 : 0.25;
        if (h < share) pl.color.setRGB(pl.natural.r, pl.natural.r * 0.3, pl.natural.r * 0.9);
      } else if (season === 'autumn' && kind !== 'aspen' && h > 0.88) {
        pl.color.copy(pl.natural);
      } else {
        const k = (h * 7.31) % 1;
        const gold = { aspen: 0.92 + 0.08 * k, ash: 0.7 + 0.22 * k, rowan: 0.5 + 0.08 * k, oak: 0.55 + 0.14 * k, bush: 0.55 + 0.35 * k, needles: 1 }[kind];
        pl.color.setRGB(1, gold, 0.3);
      }
    }
  }

  /** Where each tree stands, with the radius of its crown (m): for laying out camera moves that miss them. */
  spots() {
    return this.placements.map((p) => ({ x: p.center.x, z: p.center.z, r: p.radius * 0.5 }));
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
    for (const bm of this.berries.flat()) if (bm) bm.count = 0;
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
      // The quality preset pulls the finer levels in (the impostor distance stays put, so they don't pop closer).
      let lod = LODS.findIndex((l, i) => d < (i < LODS.length - 1 ? l.maxDist * quality.treeDetail : l.maxDist));
      // Beyond the last level but impostors aren't baked yet: use the coarsest geometry.
      if (lod === -1) lod = LODS.length - 1;
      const [branches, leaves] = this.meshes[pl.variant][lod];
      branches.setMatrixAt(branches.count, pl.matrix);
      leaves.setMatrixAt(leaves.count, pl.matrix);
      leaves.setColorAt(leaves.count, pl.color);
      branches.count++;
      leaves.count++;
      const bm = this.fruiting ? this.berries[pl.variant][lod] : null;
      if (bm) bm.setMatrixAt(bm.count++, pl.matrix);
    }
    for (const bm of this.berries.flat()) {
      if (!bm || bm.count === 0) continue;
      bm.instanceMatrix.clearUpdateRanges();
      bm.instanceMatrix.addUpdateRange(0, bm.count * 16);
      bm.instanceMatrix.needsUpdate = true;
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
