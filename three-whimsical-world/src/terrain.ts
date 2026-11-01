import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

export const TERRAIN_SIZE = 2000;
const SEGMENTS = 800;

/** Returns terrain height in meters at world (x, z). Sea level is y = 0. */
export type HeightFn = (x: number, z: number) => number;

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Procedural meadows: rolling hills inland (-x), a beach, and open sea toward +x.
 * This is the swappable height source; a Valheim seed-based generator can replace it later.
 */
export function createMeadowHeight(seed = 1337): HeightFn {
  const noise = createNoise2D(mulberry32(seed));

  const fbm = (x: number, z: number, octaves: number) => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * noise(x * freq, z * freq);
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  };

  const ridged = (x: number, z: number, octaves: number) => {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * (1 - Math.abs(noise(x * freq + 91, z * freq - 37)));
      norm += amp;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum / norm;
  };

  return (x, z) => {
    // Domain warp keeps hills from looking like uniform noise blobs.
    const wx = x + 60 * noise(x * 0.0015, z * 0.0015);
    const wz = z + 60 * noise(x * 0.0015 + 31.7, z * 0.0015 - 17.3);

    const hills = fbm(wx * 0.0028, wz * 0.0028, 6);
    let meadow = 9 + hills * 11 + 1.2 * fbm(x * 0.03, z * 0.03, 3);

    // Darker, higher hills far inland, as a backdrop.
    const backdrop = smoothstep(-250, -800, x);
    meadow += backdrop * 70 * ridged(wx * 0.002, wz * 0.002, 5);

    // Wavy coastline running roughly north-south at x ≈ 220.
    const coastX = 220 + 110 * fbm(z * 0.0018, 4.2, 4);
    const inland = coastX - x;

    const seabed = -22 + 5 * fbm(x * 0.004, z * 0.004, 3);
    const land = smoothstep(-70, 150, inland);
    let h = lerp(seabed, meadow, land);

    // Flatten a gentle beach shelf right at the shoreline.
    const beach = smoothstep(-35, 0, inland) * (1 - smoothstep(10, 55, inland));
    h = lerp(h, 0.8 + 0.6 * (inland / 50), beach * 0.75);

    return h;
  };
}

const COLORS = {
  grassLush: new THREE.Color('#4f6f28'),
  grassDry: new THREE.Color('#7c8a38'),
  dirt: new THREE.Color('#6a573a'),
  rock: new THREE.Color('#6c6862'),
  sand: new THREE.Color('#c4a874'),
  wetSand: new THREE.Color('#7a6646'),
  seabed: new THREE.Color('#6f6448'),
};

/** How likely grass grows here (0..1), from height above sea and slope (rise over run). Shared by grass and terrain shading. */
export function grassCoverage(h: number, slope: number): number {
  return smoothstep(2.4, 3.6, h) * (1 - smoothstep(0.5, 0.8, slope));
}

/** Distance (m) within which the ground is covered by grass blades; set by the grass system. */
export const terrainUniforms = { uGrassRadius: { value: 120 } };

export function createTerrainMesh(height: HeightFn): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, SEGMENTS, SEGMENTS);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, height(pos.getX(i), pos.getZ(i)));
  }
  geo.computeVertexNormals();

  const normals = geo.attributes.normal as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const grass = new Float32Array(pos.count);
  const variation = createNoise2D(mulberry32(7));
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ny = normals.getY(i);
    const slope = 1 - ny;
    grass[i] = grassCoverage(y, Math.sqrt(Math.max(1 - ny * ny, 0)) / ny);
    const v = 0.5 + 0.5 * variation(x * 0.012, z * 0.012);
    const fine = 0.5 + 0.5 * variation(x * 0.09 + 50, z * 0.09);

    c.copy(COLORS.grassLush).lerp(COLORS.grassDry, v * 0.8);
    c.lerp(COLORS.dirt, smoothstep(0.12, 0.3, slope) * 0.85);
    c.lerp(COLORS.rock, smoothstep(0.3, 0.5, slope));

    // Beach and seabed by height.
    const sandAmt = 1 - smoothstep(1.6, 3.2 + fine * 1.5, y);
    c.lerp(COLORS.sand, sandAmt);
    c.lerp(COLORS.wetSand, 1 - smoothstep(-0.3, 0.7, y));
    c.lerp(COLORS.seabed, 1 - smoothstep(-6, -1, y));

    // Subtle brightness jitter so flat areas aren't one tone.
    c.multiplyScalar(0.9 + 0.2 * fine);
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aGrass', new THREE.BufferAttribute(grass, 1));

  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.95, specularIntensity: 0.15 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, terrainUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aGrass;\nvarying float vGrass;\nvarying vec3 vWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrass = aGrass;\nvWorld = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vGrass;
        varying vec3 vWorld;
        uniform float uGrassRadius;
        float wetSand = 0.0;
        float tHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float tNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(tHash(i), tHash(i + vec2(1, 0)), u.x), mix(tHash(i + vec2(0, 1)), tHash(i + vec2(1, 1)), u.x), u.y);
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float camDist = distance(vWorld.xz, cameraPosition.xz);
        // Under the blades the ground is in the grass's own shade; past the grass radius it stands in for the grass tops.
        float under = vGrass * (1.0 - smoothstep(uGrassRadius * 0.5, uGrassRadius * 0.95, camDist));
        diffuseColor.rgb *= mix(1.0, 0.3, under);
        // Mottling so distant meadow and sand don't read as flat paint.
        float mottle = tNoise(vWorld.xz * 0.35) * 0.6 + tNoise(vWorld.xz * 1.9) * 0.4;
        diffuseColor.rgb *= 0.82 + 0.36 * mottle;
        // Beach: wind ripples and grain on dry sand, a darker band where waves wet it.
        float sand = 1.0 - smoothstep(2.0, 3.6, vWorld.y);
        float warp = tNoise(vWorld.xz * 0.08) * 6.0;
        float ripple = 0.5 + 0.5 * sin(dot(vWorld.xz, vec2(0.83, 0.55)) * 4.5 + warp);
        float grain = tNoise(vWorld.xz * 23.0);
        diffuseColor.rgb *= mix(1.0, 0.84 + 0.18 * ripple + 0.12 * (grain - 0.5), sand);
        wetSand = sand * (1.0 - smoothstep(0.2, 1.1, vWorld.y + 0.3 * tNoise(vWorld.xz * 0.5)));
        diffuseColor.rgb *= mix(1.0, 0.62, wetSand);`,
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.35, wetSand);');
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}

/** Water depth (meters below sea level, clamped to 0..maxDepth) baked into a texture for the water shader. */
export function createDepthTexture(height: HeightFn, resolution = 512, maxDepth = 10): THREE.DataTexture {
  const data = new Uint8Array(resolution * resolution);
  for (let j = 0; j < resolution; j++) {
    for (let i = 0; i < resolution; i++) {
      const x = (i / (resolution - 1) - 0.5) * TERRAIN_SIZE;
      const z = (j / (resolution - 1) - 0.5) * TERRAIN_SIZE;
      const depth = Math.min(Math.max(-height(x, z), 0), maxDepth);
      data[j * resolution + i] = Math.round((depth / maxDepth) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, resolution, resolution, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
