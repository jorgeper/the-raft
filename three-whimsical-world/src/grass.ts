import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { coverageFrom } from './terrain';
import type { WorldFns } from './worldgen';
import { addWind, sunLight } from './wind';
import { weatherUniforms } from './weather';
import { quality } from './quality';

const CHUNK = 24;

/** Blade color on the heath (see `WorldFns.heath`). */
const HEATH_TINT = new THREE.Color('#7a4c68');
/** Default reach; the quality preset sets the live one (`quality.grassRadius`). */
export const GRASS_RADIUS = 120;
// Many thin blades rather than fewer wide ones: Valheim's meadow reads as a full, soft field.
const BLADES_PER_CHUNK = 44000;
const FULL_DENSITY_DIST = 22;
const GRID = 2; // height sampling step inside a chunk, meters
const CLUMP_SIZE = 0.9; // meters between clump centers

/**
 * A single tapered blade, 1 unit tall, leaning toward +z (instance scale.z sets how far).
 * Normals curve across the width so the blade shades like a rounded leaf, not a flat card.
 */
function createBladeGeometry() {
  const segments = 5;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  // Across the blade: -1 at the left edge, +1 at the right, 0 at the tip (for the midrib and veins).
  const side: number[] = [];
  const indices: number[] = [];
  const base = new THREE.Color(0.16, 0.2, 0.1);
  // Sun-bleached, yellowing tips like Valheim's meadow grass.
  const tip = new THREE.Color(1.22, 1.16, 0.72);
  const c = new THREE.Color();
  for (let i = 0; i < segments; i++) {
    const t = i / segments;
    const halfWidth = 0.016 * (1 - 0.75 * t ** 1.4);
    const lean = 0.35 * t * t;
    positions.push(-halfWidth, t, lean, halfWidth, t, lean);
    // Face direction tilts back as the blade leans forward.
    const fz = 1, fy = 0.7 * t;
    normals.push(-0.5, fy, fz, 0.5, fy, fz);
    c.copy(base).lerp(tip, Math.pow(t, 0.8));
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    side.push(-1, 1);
  }
  positions.push(0, 1, 0.35);
  normals.push(0, 0.7, 1);
  colors.push(tip.r, tip.g, tip.b);
  side.push(0);
  for (let i = 0; i < segments - 1; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const last = (segments - 1) * 2;
  indices.push(last, last + 1, last + 2);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  geo.setIndex(indices);
  geo.normalizeNormals();
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

/** Stateless hash of an integer cell to [0, 1). */
function cellHash(ix: number, iz: number, k: number) {
  let h = Math.imul(ix, 73856093) ^ Math.imul(iz, 19349663) ^ Math.imul(k, 83492791);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

interface Clump { x: number; z: number; height: number; tint: number; lean: number }

/** Nearest jittered clump center (cellular noise), with the clump's shared traits. */
function clumpAt(x: number, z: number, out: Clump) {
  const gx = Math.floor(x / CLUMP_SIZE), gz = Math.floor(z / CLUMP_SIZE);
  let best = Infinity;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const ix = gx + dx, iz = gz + dz;
      const cx = (ix + cellHash(ix, iz, 1)) * CLUMP_SIZE;
      const cz = (iz + cellHash(ix, iz, 2)) * CLUMP_SIZE;
      const d = (cx - x) ** 2 + (cz - z) ** 2;
      if (d < best) {
        best = d;
        out.x = cx;
        out.z = cz;
        out.height = 0.7 + 0.6 * cellHash(ix, iz, 3);
        out.tint = cellHash(ix, iz, 4);
        out.lean = 0.5 + cellHash(ix, iz, 5);
      }
    }
  }
  return Math.sqrt(best);
}

export class Grass {
  readonly group = new THREE.Group();
  private chunks = new Map<string, THREE.InstancedMesh>();
  private geometry = createBladeGeometry();
  private material: THREE.MeshPhysicalMaterial;
  private fade = { uFadeStart: { value: GRASS_RADIUS * 0.6 }, uFadeEnd: { value: GRASS_RADIUS }, uWiden: { value: 1 } };
  private colorNoise = createNoise2D(hashSeed(11, 5));
  private lush = new THREE.Color('#74a01e');
  private deep = new THREE.Color('#58861e');
  private dry = new THREE.Color('#b4b040');
  // Under the forest canopy the little grass there is darker and bluer.
  private shade = new THREE.Color('#2a4a1c');

  constructor(private world: WorldFns) {
    this.material = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.55,
      specularIntensity: 0.25,
    });
    addWind(
      this.material,
      /* glsl */ `
        float camDist = distance(root.xz, cameraPosition.xz);
        float fade = 1.0 - smoothstep(uFadeStart, uFadeEnd, camDist);
        vec3 local = p - root;
        // Shrink into the ground at the edge of the grass radius, and widen distant blades to make up for thinning.
        local.y *= fade;
        // Lower quality presets draw fewer, wider blades so the field still reads as full.
        local.xz *= (1.0 + camDist / 25.0) * uWiden;
        float bladeHeight = length(instanceMatrix[1].xyz);
        float flex = position.y * position.y * bladeHeight;
        p = root + local + windOffset(root, flex * 0.6) * fade;
        vTip = position.y;
      `,
      this.fade,
    );

    const patchVertex = this.material.onBeforeCompile;
    this.material.onBeforeCompile = (shader, renderer) => {
      patchVertex.call(this.material, shader, renderer);
      Object.assign(shader.uniforms, sunLight, weatherUniforms);
      shader.vertexShader = ('varying float vTip;\nattribute float aSide;\nvarying float vSide;\nvarying float vBlade;\n' + shader.vertexShader)
        .replace(
          '#include <beginnormal_vertex>',
          // Bias normals upward so the field reads as one soft surface while blades keep some individual shading.
          '#include <beginnormal_vertex>\nobjectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), 0.45));',
        )
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvSide = aSide;\nvBlade = fract(sin(float(gl_InstanceID) * 12.9898) * 43758.5453);',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying float vTip;\nvarying float vSide;\nvarying float vBlade;\nuniform vec3 uSunDirView;\nuniform vec3 uSunColor;\nuniform float uDew;\nuniform float uWet;',
        )
        .replace(
          '#include <color_fragment>',
          // Blade detail: a pale midrib, fine lengthwise veins, darker edges, and some blades with sun-dried tips.
          // (Only reads up close; far blades are a pixel wide and average to the plain color.)
          `#include <color_fragment>
          float across = abs(vSide) / max(1.0 - vTip * 0.9, 0.1);
          float rib = 1.0 - smoothstep(0.0, 0.22, across);
          diffuseColor.rgb *= (1.0 + 0.22 * rib) * (0.93 + 0.07 * cos(across * 15.7)) * (1.0 - 0.2 * smoothstep(0.65, 1.0, across));
          float dried = step(0.82, vBlade) * smoothstep(0.55 + 0.25 * fract(vBlade * 7.0), 0.95, vTip);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.48, 0.22) * (0.8 + 0.4 * fract(vBlade * 13.0)), dried * 0.85);
          diffuseColor.rgb *= 0.9 + 0.2 * fract(vBlade * 3.7);
          diffuseColor.rgb *= 1.0 - 0.22 * uWet;`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          // Translucency: blades glow warm yellow-green when the sun is behind them, strongest at the tips.
          `#include <emissivemap_fragment>
          float backlit = pow(max(dot(normalize(-vViewPosition), uSunDirView), 0.0), 3.0);
          totalEmissiveRadiance += uSunColor * diffuseColor.rgb * vec3(1.1, 1.25, 0.6) * backlit * vTip * vTip * 0.8;
          // Dew: a few drops along each blade glint when they catch the sun just so (close by only).
          if (uDew > 0.01) {
            float drop = step(0.9, fract(sin(dot(vec2(floor(vTip * 16.0), vBlade * 97.0), vec2(12.9898, 78.233))) * 43758.5453));
            vec3 Vd = normalize(-vViewPosition);
            float glint = pow(max(dot(normal, normalize(Vd + uSunDirView)), 0.0), 60.0);
            totalEmissiveRadiance += uSunColor * drop * glint * uDew * 6.0 * (1.0 - smoothstep(6.0, 18.0, -vViewPosition.z));
          }`,
        )
        // Blade bases sit in the field's shade; keep sky reflections off them.
        .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectSpecular *= vTip * vTip;');
    };
  }

  dispose() {
    for (const mesh of this.chunks.values()) mesh.dispose();
    this.chunks.clear();
    this.group.clear();
    this.geometry.dispose();
    this.material.dispose();
  }

  /** Builds or drops chunks around the viewer. `budget` caps new chunks per call to avoid frame hitches. */
  update(viewer: THREE.Vector3, budget = 3) {
    const radius = quality.grassRadius;
    this.fade.uFadeStart.value = radius * 0.6;
    this.fade.uFadeEnd.value = radius;
    this.fade.uWiden.value = 1 / Math.sqrt(quality.grassDensity);
    const cx0 = Math.floor(viewer.x / CHUNK), cz0 = Math.floor(viewer.z / CHUNK);
    const span = Math.ceil(radius / CHUNK);
    const wanted: { key: string; cx: number; cz: number; d: number }[] = [];

    for (let cz = cz0 - span; cz <= cz0 + span; cz++) {
      for (let cx = cx0 - span; cx <= cx0 + span; cx++) {
        const d = Math.hypot((cx + 0.5) * CHUNK - viewer.x, (cz + 0.5) * CHUNK - viewer.z);
        if (d < radius + CHUNK * 0.71) wanted.push({ key: `${cx},${cz}`, cx, cz, d });
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
      // Distance to the chunk's nearest point, so the chunk you stand in is always full.
      const near = Math.max(0, w.d - CHUNK * 0.71);
      const t = THREE.MathUtils.clamp((near - FULL_DENSITY_DIST) / (radius - FULL_DENSITY_DIST), 0, 1);
      mesh.count = Math.floor(mesh.userData.total * quality.grassDensity * Math.max(0.06, (1 - t) ** 2.2));
    }
  }

  private buildChunk(cx: number, cz: number): THREE.InstancedMesh {
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const n = CHUNK / GRID + 1;
    const heights = new Float32Array(n * n);
    const forests = new Float32Array(n * n);
    const dirts = new Float32Array(n * n), heaths = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const gx = x0 + i * GRID, gz = z0 + j * GRID;
        heights[j * n + i] = this.world.height(gx, gz);
        forests[j * n + i] = this.world.forest(gx, gz);
        dirts[j * n + i] = this.world.dirt(gx, gz);
        heaths[j * n + i] = this.world.heath(gx, gz);
      }
    }
    const bilerp = (a: Float32Array, gx: number, gz: number, fx: number, fz: number) =>
      (a[gz * n + gx] * (1 - fx) + a[gz * n + gx + 1] * fx) * (1 - fz) + (a[(gz + 1) * n + gx] * (1 - fx) + a[(gz + 1) * n + gx + 1] * fx) * fz;

    const rand = hashSeed(cx, cz);
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, BLADES_PER_CHUNK);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
    const clump: Clump = { x: 0, z: 0, height: 1, tint: 0, lean: 1 };
    let placed = 0;
    // Ponds: no blades in the water, thinning to the shore.
    const half = CHUNK / 2;
    const nearPond = this.world.ponds.some((p) => Math.abs(p.x - x0 - half) < half + p.radius * 2.5 && Math.abs(p.z - z0 - half) < half + p.radius * 2.5);

    for (let k = 0; k < BLADES_PER_CHUNK; k++) {
      const lx = rand() * CHUNK, lz = rand() * CHUNK;
      const gx = Math.min(Math.floor(lx / GRID), n - 2), gz = Math.min(Math.floor(lz / GRID), n - 2);
      const fx = lx / GRID - gx, fz = lz / GRID - gz;
      const h00 = heights[gz * n + gx], h10 = heights[gz * n + gx + 1];
      const h01 = heights[(gz + 1) * n + gx], h11 = heights[(gz + 1) * n + gx + 1];
      const h = (h00 * (1 - fx) + h10 * fx) * (1 - fz) + (h01 * (1 - fx) + h11 * fx) * fz;
      const slope = Math.hypot(h10 - h00, h01 - h00) / GRID;

      const x = x0 + lx, z = z0 + lz;
      const forest = bilerp(forests, gx, gz, fx, fz);
      if (rand() > coverageFrom(h, slope, forest, bilerp(dirts, gx, gz, fx, fz))) continue;
      if (nearPond && this.world.pondEdge(x, z) < 0.4 + rand() * 1.6) continue;
      const dry = 0.5 + 0.5 * this.colorNoise(x * 0.012, z * 0.012);
      // Sparse, short patches where it's dry, and on the heath, where heather takes over.
      if (dry > 0.78 && rand() < (dry - 0.78) * 2.5) continue;
      const heath = bilerp(heaths, gx, gz, fx, fz);
      if (heath > 0 && rand() < heath * 0.75) continue;

      const fromCenter = clumpAt(x, z, clump);
      // Blades fan outward from their clump center and are tallest in the middle.
      const outward = Math.atan2(x - clump.x, z - clump.z);
      // Knee- to thigh-high on the character, like Valheim's meadows.
      const bladeHeight = 0.78 * (0.45 + rand() * 0.45) * clump.height * (1.2 - 0.45 * fromCenter / CLUMP_SIZE) * (1.15 - 0.4 * dry) * (1 - 0.35 * forest) * (1 - 0.6 * heath);
      q.setFromAxisAngle(up, outward + (rand() - 0.5) * 1.2);
      s.set(0.75 + rand() * 0.6, bladeHeight, clump.lean * (0.6 + rand() * 0.8));
      p.set(x, h - 0.05, z);
      mesh.setMatrixAt(placed, m.compose(p, q, s));

      c.copy(this.deep).lerp(this.lush, clump.tint).lerp(this.dry, Math.min(dry * dry * 0.85 + rand() * 0.15, 1));
      c.lerp(this.shade, forest);
      // On the heath the sward is half heather: a muted mauve-brown that reads as a drift from afar.
      if (heath > 0) c.lerp(HEATH_TINT, heath * 0.5);
      c.multiplyScalar(0.8 + rand() * 0.35);
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
    mesh.boundingSphere!.radius += 3;
    return mesh;
  }
}
