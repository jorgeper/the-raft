import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { TERRAIN_SIZE } from './terrain';
import { mulberry32, smoothstep, type WorldFns } from './worldgen';
import { addWind, sunLight } from './wind';
import { plants } from './plants';
import { quality } from './quality';
import { createMushroomGeometry, createReedGeometry, createShrubGeometry, createShrubLeafTexture, headColored } from './undergrowth';

const CHUNK = 24;
const GRID = 4;

/** Draws one fern frond (stem plus tapering leaflets) into a transparent texture. */
function createFrondTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const cx = 64;
  ctx.strokeStyle = '#6d8a3a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, 512);
  ctx.lineTo(cx, 8);
  ctx.stroke();
  // Leaflets: pairs angled toward the tip, longest a third of the way up, shrinking to the tip.
  for (let y = 500; y > 14; y -= 13) {
    const t = 1 - y / 512;
    const len = 58 * Math.sin(Math.PI * Math.min(t * 1.25 + 0.12, 1)) * (1 - t * 0.35);
    const shade = 150 + Math.round(70 * t);
    ctx.fillStyle = `rgb(${Math.round(shade * 0.45)}, ${shade}, ${Math.round(shade * 0.32)})`;
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.translate(cx, y);
      ctx.rotate(dir * (Math.PI / 2 - 0.45));
      ctx.beginPath();
      ctx.ellipse(0, -len / 2, 6.5, len / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A fern: textured fronds arching out from the center and drooping at the tips. */
function createFernGeometry() {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const fronds = 9, segments = 7;
  for (let f = 0; f < fronds; f++) {
    const theta = (f / fronds) * Math.PI * 2 + (f % 3) * 0.25;
    const length = 0.85 + (f % 4) * 0.12;
    const lift = 0.55 + (f % 3) * 0.15;
    const dir = new THREE.Vector3(Math.cos(theta), 0, Math.sin(theta));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const base = positions.length / 3;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      // Rises, then arches over and droops.
      const centre = dir.clone().multiplyScalar(t * length);
      centre.y = Math.sin(Math.PI * t * 0.8) * lift * length * 0.6 + 0.03;
      const halfWidth = 0.17 * length;
      for (const k of [-1, 1]) {
        const p = centre.clone().addScaledVector(side, k * halfWidth);
        // Leaflets tilt down at the edges a little, like a real frond.
        p.y -= 0.04 * t;
        positions.push(p.x, p.y, p.z);
        uvs.push(k < 0 ? 0 : 1, t);
        const shade = 0.4 + 0.6 * Math.min(t * 1.5, 1);
        colors.push(shade, shade, shade);
      }
      if (s < segments) {
        const a = base + s * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  // Soft, mostly-up normals so the fern shades as a clump.
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(positions.length / 3).fill([0.1, 1, 0.1]).flat(), 3));
  geo.normalizeNormals();
  return geo;
}

/** A small flower: thin stem and a flat ring of petals. `aHead` marks petal vertices so only they take the instance color. */
function createFlowerGeometry() {
  const positions: number[] = [];
  const head: number[] = [];
  const stemTop = 0.32, w = 0.008;
  positions.push(-w, 0, 0, w, 0, 0, 0, stemTop, 0, 0, 0, -w, 0, 0, w, 0, stemTop, 0);
  head.push(0, 0, 0, 0, 0, 0);
  const petals = 7, r = 0.045;
  for (let i = 0; i < petals; i++) {
    const a0 = (i / petals) * Math.PI * 2, a1 = ((i + 1) / petals) * Math.PI * 2;
    positions.push(0, stemTop + 0.01, 0, Math.cos(a0) * r, stemTop, Math.sin(a0) * r, Math.cos(a1) * r, stemTop, Math.sin(a1) * r);
    head.push(1, 1, 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aHead', new THREE.Float32BufferAttribute(head, 1));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(positions.length / 3).fill([0, 1, 0]).flat(), 3));
  return geo;
}

interface LayerSpec {
  radius: number;
  perChunk: number;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Returns a scale (> 0) to place an instance here, or 0 to skip; may set `color`. */
  place: (x: number, z: number, h: number, forest: number, rand: () => number, color: THREE.Color) => number;
}

/** Instances scattered in chunks around the viewer, thinned with distance (like the grass). */
class ScatterLayer {
  readonly group = new THREE.Group();
  private chunks = new Map<string, THREE.InstancedMesh>();

  constructor(private world: WorldFns, private spec: LayerSpec, private salt: number) {}

  update(viewer: THREE.Vector3, budget: number) {
    const radius = this.spec.radius * quality.coverRadius;
    const cx0 = Math.floor(viewer.x / CHUNK), cz0 = Math.floor(viewer.z / CHUNK);
    const span = Math.ceil(radius / CHUNK);
    const keep = new Set<string>();
    for (let cz = cz0 - span; cz <= cz0 + span; cz++) {
      for (let cx = cx0 - span; cx <= cx0 + span; cx++) {
        const d = Math.hypot((cx + 0.5) * CHUNK - viewer.x, (cz + 0.5) * CHUNK - viewer.z);
        if (d > radius + CHUNK * 0.71) continue;
        const key = `${cx},${cz}`;
        keep.add(key);
        let mesh = this.chunks.get(key);
        if (!mesh) {
          if (budget-- <= 0) continue;
          mesh = this.build(cx, cz);
          this.chunks.set(key, mesh);
          this.group.add(mesh);
        }
        const near = Math.max(0, d - CHUNK * 0.71);
        mesh.count = Math.floor(mesh.userData.total * quality.coverDensity * Math.max(0.1, (1 - Math.min(near / radius, 1)) ** 1.5));
      }
    }
    for (const [key, mesh] of this.chunks) {
      if (keep.has(key)) continue;
      this.group.remove(mesh);
      mesh.dispose();
      this.chunks.delete(key);
    }
    return budget;
  }

  private build(cx: number, cz: number) {
    const x0 = cx * CHUNK, z0 = cz * CHUNK, n = CHUNK / GRID + 1;
    const heights = new Float32Array(n * n), forests = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        heights[j * n + i] = this.world.height(x0 + i * GRID, z0 + j * GRID);
        forests[j * n + i] = this.world.forest(x0 + i * GRID, z0 + j * GRID);
      }
    }
    const rand = mulberry32((cx * 73856093) ^ (cz * 19349663) ^ this.salt);
    const mesh = new THREE.InstancedMesh(this.spec.geometry, this.spec.material, this.spec.perChunk);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const color = new THREE.Color();
    let placed = 0;
    for (let k = 0; k < this.spec.perChunk; k++) {
      const lx = rand() * CHUNK, lz = rand() * CHUNK;
      const gx = Math.min(Math.floor(lx / GRID), n - 2), gz = Math.min(Math.floor(lz / GRID), n - 2);
      const fx = lx / GRID - gx, fz = lz / GRID - gz;
      const lerp2 = (a: Float32Array) =>
        (a[gz * n + gx] * (1 - fx) + a[gz * n + gx + 1] * fx) * (1 - fz) + (a[(gz + 1) * n + gx] * (1 - fx) + a[(gz + 1) * n + gx + 1] * fx) * fz;
      const h = lerp2(heights), forest = lerp2(forests);
      color.setRGB(1, 1, 1);
      const scale = this.spec.place(x0 + lx, z0 + lz, h, forest, rand, color);
      if (scale <= 0) continue;
      e.set((rand() - 0.5) * 0.2, rand() * Math.PI * 2, (rand() - 0.5) * 0.2);
      mesh.setMatrixAt(placed, m.compose(p.set(x0 + lx, h - 0.03, z0 + lz), q.setFromEuler(e), s.setScalar(scale)));
      mesh.setColorAt(placed, color);
      placed++;
    }
    mesh.userData.total = placed;
    mesh.count = placed;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere) mesh.boundingSphere.radius += 2;
    return mesh;
  }

  dispose() {
    for (const mesh of this.chunks.values()) mesh.dispose();
    this.chunks.clear();
    this.group.clear();
  }
}

/** Ferns and flowers near the viewer, plus fallen logs and stumps placed once across the forests. */
export class GroundCover {
  readonly group = new THREE.Group();
  private layers: ScatterLayer[] = [];
  private disposables: { dispose(): void }[] = [];

  constructor(world: WorldFns) {
    const { params } = world;
    const patchNoise = createNoise2D(mulberry32(params.seed * 17 + 3));

    // Ferns carpet the forest floor and spill a little into the meadow edges: photoscanned ones when
    // `npm run assets` has fetched them (four variants, one layer each), else the procedural frond.
    const scanned = plants.fern;
    if (scanned) {
      const fernMat = new THREE.MeshStandardMaterial({
        map: scanned.material.map,
        normalMap: scanned.material.normalMap,
        alphaTest: 0.45,
        alphaToCoverage: true,
        side: THREE.DoubleSide,
        roughness: 0.8,
      });
      // Fronds sway more toward their tips.
      addWind(fernMat, `p += windOffset(root, max(p.y - root.y, 0.0) * 0.7) * 0.35;`);
      const windCompile = fernMat.onBeforeCompile;
      fernMat.onBeforeCompile = (shader, renderer) => {
        windCompile.call(fernMat, shader, renderer);
        Object.assign(shader.uniforms, sunLight);
        shader.vertexShader = shader.vertexShader.replace(
          '#include <beginnormal_vertex>',
          // Bend normals toward up so the clump shades as one soft mass instead of dark, edge-on cards.
          '#include <beginnormal_vertex>\nobjectNormal = normalize(mix(objectNormal, vec3(0.0, 1.0, 0.0), 0.5));',
        );
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform vec3 uSunDirView;\nuniform vec3 uSunColor;')
          .replace(
            '#include <emissivemap_fragment>',
            // Thin fronds glow when the sun is behind them, and pass some light through even in shade.
            `#include <emissivemap_fragment>
            float backlit = pow(max(dot(normalize(-vViewPosition), uSunDirView), 0.0), 2.0);
            totalEmissiveRadiance += uSunColor * diffuseColor.rgb * vec3(0.9, 1.05, 0.6) * (0.06 + 0.5 * backlit);`,
          );
      };
      // Brighter than the bare scan: it was shot in overcast light, the game's forest floor is sunnier.
      // Kept below neon: deep, slightly blue greens sit with the scanned rocks and the forest floor.
      const fernTints = ['#f4f8ec', '#e2ecd6', '#e8eadc', '#d4e2cc', '#dce6d2'].map((c) => new THREE.Color(c).multiplyScalar(1.2));
      scanned.geometries.forEach((geometry, v) => {
        this.layers.push(
          new ScatterLayer(
            world,
            {
              radius: 80,
              perChunk: 300,
              geometry,
              material: fernMat,
              place: (x, z, h, forest, rand, color) => {
                const patch = 0.5 + 0.5 * patchNoise(x * 0.05, z * 0.05);
                if (h < 3 || rand() > smoothstep(0.15, 0.6, forest) * (0.6 + 0.4 * patch)) return 0;
                color.copy(fernTints[Math.floor(rand() * fernTints.length)]);
                // The scans are ~1 m across and 0.4 m tall; Valheim's are waist-high on the bigger plants.
                return 1.2 + rand() * rand() * 1.4;
              },
            },
            11 + v,
          ),
        );
      });
      this.disposables.push(fernMat);
    } else {
      const fernGeo = createFernGeometry();
      const frondTexture = createFrondTexture();
      const fernMat = new THREE.MeshPhysicalMaterial({
        map: frondTexture,
        vertexColors: true,
        alphaTest: 0.5,
        alphaToCoverage: true,
        side: THREE.DoubleSide,
        roughness: 0.75,
        specularIntensity: 0.15,
      });
      addWind(fernMat, `p += windOffset(root, position.y * 0.25) * 0.5;`);
      const fernTints = ['#c8e0b0', '#b0d090', '#a8c890', '#d8e8a8'].map((c) => new THREE.Color(c));
      this.layers.push(
        new ScatterLayer(
          world,
          {
            radius: 80,
            perChunk: 1100,
            geometry: fernGeo,
            material: fernMat,
            place: (x, z, h, forest, rand, color) => {
              if (h < 3 || rand() > forest * 0.85 * (0.5 + 0.5 * patchNoise(x * 0.05, z * 0.05) + 0.4)) return 0;
              color.copy(fernTints[Math.floor(rand() * fernTints.length)]);
              return 0.65 + rand() * 0.7;
            },
          },
          1,
        ),
      );
      this.disposables.push(fernGeo, fernMat, frondTexture);
    }

    // Meadow flowers in drifts: dandelion yellow, white, and thistle purple.
    const flowerGeo = createFlowerGeometry();
    const flowerMat = new THREE.MeshPhysicalMaterial({ side: THREE.DoubleSide, roughness: 0.7, specularIntensity: 0.2 });
    addWind(flowerMat, `p += windOffset(root, position.y * 1.2) * 0.4;`);
    const prevCompile = flowerMat.onBeforeCompile;
    flowerMat.onBeforeCompile = (shader, renderer) => {
      prevCompile.call(flowerMat, shader, renderer);
      // Stems stay green; only petals take the per-instance flower color.
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aHead;\nvarying vec3 vFlower;')
        .replace(
          '#include <begin_vertex>',
          // Chunks where no flowers landed have no per-instance colors at all.
          `#include <begin_vertex>
          #ifdef USE_INSTANCING_COLOR
            vFlower = mix(vec3(0.18, 0.32, 0.08), instanceColor.rgb, aHead);
          #else
            vFlower = vec3(0.18, 0.32, 0.08);
          #endif`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vFlower;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vFlower;');
    };
    const flowerColors = ['#f2c419', '#f2c419', '#f4f1e6', '#9b6cc7'].map((c) => new THREE.Color(c));
    this.layers.push(
      new ScatterLayer(
        world,
        {
          radius: 70,
          perChunk: Math.round(900 * params.flowers),
          geometry: flowerGeo,
          material: flowerMat,
          place: (x, z, h, forest, rand, color) => {
            if (h < 3 || forest > 0.5) return 0;
            const drift = smoothstep(0.1, 0.6, patchNoise(x * 0.02 + 50, z * 0.02));
            if (rand() > drift * (1 - forest)) return 0;
            // Each drift leans toward one species, with strays mixed in.
            const species = rand() < 0.75 ? Math.floor((patchNoise(x * 0.01, z * 0.01 + 9) * 0.5 + 0.5) * 4) % 4 : Math.floor(rand() * 4);
            color.copy(flowerColors[species]);
            return 0.8 + rand() * 0.6;
          },
        },
        2,
      ),
    );
    this.addUndergrowth(world, patchNoise);
    for (const layer of this.layers) this.group.add(layer.group);
    this.disposables.push(flowerGeo, flowerMat);

    this.addLogsAndStumps(world);
  }

  /** Mushrooms on the forest floor, reeds along the rivers, and berry shrubs at the forest edge. */
  private addUndergrowth(world: WorldFns, patchNoise: (x: number, y: number) => number) {
    // Mushrooms: fly agaric red, brown boletes and pale clusters, in damp patches under the trees.
    const mushroomGeo = createMushroomGeometry();
    const mushroomMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
    headColored(mushroomMat, true);
    const caps = ['#c8281c', '#d23a1e', '#8a5a32', '#a87444', '#e8d8b8', '#6e4a2a'].map((c) => new THREE.Color(c));
    this.layers.push(
      new ScatterLayer(
        world,
        {
          radius: 45,
          perChunk: 90,
          geometry: mushroomGeo,
          material: mushroomMat,
          place: (x, z, h, forest, rand, color) => {
            const damp = smoothstep(0.2, 0.7, patchNoise(x * 0.09 + 31, z * 0.09));
            if (h < 3 || rand() > smoothstep(0.3, 0.8, forest) * damp) return 0;
            // A patch tends to be one kind.
            const kind = rand() < 0.8 ? Math.floor((patchNoise(x * 0.03, z * 0.03 - 17) * 0.5 + 0.5) * caps.length) % caps.length : Math.floor(rand() * caps.length);
            color.copy(caps[kind]);
            return 1.3 + rand() * 1.1;
          },
        },
        21,
      ),
    );

    // Reeds and cattails crowd the riverbanks, standing in the shallows.
    const reedGeo = createReedGeometry();
    const reedMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.7 });
    addWind(reedMat, `p += windOffset(root, max(p.y - root.y, 0.0) * 0.9) * 0.5;`);
    headColored(reedMat);
    this.layers.push(
      new ScatterLayer(
        world,
        {
          radius: 90,
          perChunk: 260,
          geometry: reedGeo,
          material: reedMat,
          place: (x, z, h, _forest, rand, color) => {
            if (h < -0.7 || h > 1.6) return 0;
            const river = world.river(x, z);
            if (rand() > smoothstep(0.25, 0.6, river) * (0.4 + 0.6 * smoothstep(-0.2, 0.6, patchNoise(x * 0.07, z * 0.07 + 5)))) return 0;
            color.setRGB(1, 1, 1).multiplyScalar(0.85 + rand() * 0.3);
            return 0.7 + rand() * 0.6;
          },
        },
        22,
      ),
    );

    // Berry shrubs: raspberry red, blueberry blue, lingonberry scarlet, along the forest edges and in groves.
    const shrubGeo = createShrubGeometry();
    const shrubTex = createShrubLeafTexture();
    const shrubMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: shrubTex, alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.75 });
    addWind(shrubMat, `p += windOffset(root, max(p.y - root.y, 0.0) * 0.4) * 0.3;`);
    headColored(shrubMat);
    const berries = ['#c4162a', '#2a3a8c', '#e02a20', '#3b2f6e'].map((c) => new THREE.Color(c));
    this.layers.push(
      new ScatterLayer(
        world,
        {
          radius: 60,
          perChunk: 70,
          geometry: shrubGeo,
          material: shrubMat,
          place: (x, z, h, forest, rand, color) => {
            const edge = smoothstep(0.1, 0.35, forest) * (1 - smoothstep(0.6, 0.9, forest));
            if (h < 3 || rand() > edge * (0.5 + 0.5 * patchNoise(x * 0.04 - 9, z * 0.04))) return 0;
            color.copy(berries[Math.floor((patchNoise(x * 0.02 + 3, z * 0.02) * 0.5 + 0.5) * berries.length) % berries.length]);
            // Knee- to thigh-high, like Valheim's raspberry and blueberry bushes.
            return 1.7 + rand() * 0.9;
          },
        },
        23,
      ),
    );
    this.disposables.push(mushroomGeo, mushroomMat, reedGeo, reedMat, shrubGeo, shrubMat, shrubTex);
  }

  private addLogsAndStumps(world: WorldFns) {
    const { height, params } = world;
    const rand = mulberry32(params.seed * 23 + 11);
    const material = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.95, specularIntensity: 0.1 });
    const mossy = (geo: THREE.BufferGeometry) => {
      const pos = geo.attributes.position as THREE.BufferAttribute, nrm = geo.attributes.normal as THREE.BufferAttribute;
      const colors = new Float32Array(pos.count * 3);
      const bark = new THREE.Color('#4a3424'), moss = new THREE.Color('#4f6a22'), wood = new THREE.Color('#9a7a52'), c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        c.copy(bark).multiplyScalar(0.8 + 0.4 * Math.abs(Math.sin(pos.getX(i) * 9 + pos.getZ(i) * 7)));
        // Cut ends show pale wood; tops grow moss.
        if (Math.abs(nrm.getY(i)) > 0.9 && geo.userData.cutAxis === 'y') c.copy(wood);
        else c.lerp(moss, smoothstep(0.3, 0.8, nrm.getY(i)) * 0.8);
        c.toArray(colors, i * 3);
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return geo;
    };
    // Logs lie along x; their "up" after rotation is the cylinder's side, so moss lands on top.
    const logGeo = new THREE.CylinderGeometry(0.38, 0.45, 7, 10, 1);
    logGeo.rotateZ(Math.PI / 2);
    mossy(logGeo);
    const stumpGeo = new THREE.CylinderGeometry(0.5, 0.7, 0.8, 10, 1);
    stumpGeo.userData.cutAxis = 'y';
    stumpGeo.translate(0, 0.3, 0);
    mossy(stumpGeo);

    const logs: THREE.Matrix4[] = [], stumps: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const half = TERRAIN_SIZE / 2 - 30;
    for (let i = 0; i < 20000; i++) {
      const x = (rand() * 2 - 1) * half, z = (rand() * 2 - 1) * half;
      const forest = world.forest(x, z);
      if (rand() > forest * 0.12) continue;
      const h = height(x, z);
      if (h < 3) continue;
      const k = 0.7 + rand() * 0.6;
      if (rand() < 0.5) {
        // Settle the log onto the slope along its length.
        const yaw = rand() * Math.PI * 2;
        const dx = Math.cos(yaw) * 3, dz = -Math.sin(yaw) * 3;
        const pitch = Math.atan2(height(x + dx, z + dz) - height(x - dx, z - dz), 6);
        e.set(0, yaw, pitch, 'YZX');
        logs.push(new THREE.Matrix4().compose(p.set(x, h + 0.25 * k, z), q.setFromEuler(e), s.set(k, k, k)));
      } else {
        e.set((rand() - 0.5) * 0.15, rand() * Math.PI, (rand() - 0.5) * 0.15);
        stumps.push(new THREE.Matrix4().compose(p.set(x, h - 0.1, z), q.setFromEuler(e), s.set(k, k * (0.6 + rand() * 0.8), k)));
      }
    }
    for (const [geo, list] of [[logGeo, logs], [stumpGeo, stumps]] as const) {
      if (list.length === 0) continue;
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((mtx, i) => mesh.setMatrixAt(i, mtx));
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.group.add(mesh);
    }
    this.disposables.push(logGeo, stumpGeo, material);
  }

  update(viewer: THREE.Vector3, budget = 2) {
    for (const layer of this.layers) budget = layer.update(viewer, budget);
  }

  dispose() {
    for (const layer of this.layers) layer.dispose();
    for (const d of this.disposables) d.dispose();
    this.group.clear();
  }
}
