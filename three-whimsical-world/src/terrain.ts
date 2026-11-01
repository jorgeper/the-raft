import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { mulberry32, smoothstep, type HeightFn, type WorldFns } from './worldgen';
import { groundUniforms } from './ground';
import { weatherUniforms, RAIN_RIPPLES } from './weather';

export type { HeightFn } from './worldgen';

export const TERRAIN_SIZE = 2000;
const SEGMENTS = 800;

const COLORS = {
  grassLush: new THREE.Color('#577a24'),
  grassDry: new THREE.Color('#7c8a38'),
  dirt: new THREE.Color('#6a573a'),
  // Bare earth patches on the meadow, warm orange-brown like Valheim's.
  earth: new THREE.Color('#8a6438'),
  // Forest floor: moss and needle litter.
  moss: new THREE.Color('#34461c'),
  needles: new THREE.Color('#4a3a24'),
  rock: new THREE.Color('#6c6862'),
  sand: new THREE.Color('#c4a874'),
  wetSand: new THREE.Color('#7a6646'),
  seabed: new THREE.Color('#6f6448'),
  // River shores: grey-brown gravel and stones, darker where the water wets them.
  gravel: new THREE.Color('#7a746a'),
  wetStone: new THREE.Color('#4c4842'),
  // Ponds: deep green moss carpeting the shore, dark silt under the water.
  pondMoss: new THREE.Color('#3f5a1c'),
  silt: new THREE.Color('#3a3324'),
};

/**
 * How likely grass grows here (0..1), from height above sea, slope (rise over run), bare-earth patches,
 * and forest (sparse under the canopy). Shared by grass and terrain shading.
 */
export function grassCoverage(world: WorldFns, x: number, z: number, h: number, slope: number): number {
  return coverageFrom(h, slope, world.forest(x, z), world.dirt(x, z));
}

/** grassCoverage with the forest and dirt fields already sampled. */
export function coverageFrom(h: number, slope: number, forest: number, dirt: number): number {
  const bare = dirt * (1 - forest);
  return smoothstep(2.4, 3.6, h) * (1 - smoothstep(0.5, 0.8, slope)) * (1 - bare) * (1 - 0.75 * forest);
}

/** Distance (m) within which the ground is covered by grass blades; set by the grass system. */
export const terrainUniforms = { uGrassRadius: { value: 120 } };

export function createTerrainMesh(world: WorldFns): THREE.Mesh {
  const { height } = world;
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
  // Ground texture weights (forest floor, bare earth, rock, sand); meadow soil is the remainder.
  const splat = new Float32Array(pos.count * 4);
  const w = [0, 0, 0, 0, 0];
  /** Mirrors a color lerp onto the layer weights: blends `k` of layer `layer` over everything so far. */
  const toward = (k: number, layer: number) => {
    for (let l = 0; l < 5; l++) w[l] *= 1 - k;
    w[layer] += k;
  };
  const variation = createNoise2D(mulberry32(7));
  const c = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const ny = normals.getY(i);
    const slope = 1 - ny;
    const forest = world.forest(x, z);
    const dirt = world.dirt(x, z);
    grass[i] = coverageFrom(y, Math.sqrt(Math.max(1 - ny * ny, 0)) / ny, forest, dirt);
    const earth = dirt * (1 - forest);
    const v = 0.5 + 0.5 * variation(x * 0.012, z * 0.012);
    const fine = 0.5 + 0.5 * variation(x * 0.09 + 50, z * 0.09);

    c.copy(COLORS.grassLush).lerp(COLORS.grassDry, v * 0.8);
    c.lerp(COLORS.earth, earth * 0.9);
    c.lerp(COLORS.moss, forest).lerp(COLORS.needles, forest * fine * 0.6);
    const steepDirt = smoothstep(0.12, 0.3, slope) * 0.85;
    c.lerp(COLORS.dirt, steepDirt);
    // River banks are cut rock: their ledges' risers show stone at a gentler slope than open hillsides.
    const edge = world.riverEdge(x, z);
    const riverBank = 1 - smoothstep(30, 55, edge);
    const rock = Math.max(smoothstep(0.3, 0.5, slope), riverBank * smoothstep(0.1, 0.25, slope));
    c.lerp(COLORS.rock, rock);

    // Beach and seabed by height. Sand belongs to the sea beach on gentle ground: on a steep bank the thin band
    // of heights zig-zagged across the 2.5 m triangles as a glowing sawtooth, and river shores are stony.
    const sandAmt = (1 - smoothstep(1.6, 3.2 + fine * 1.5, y)) * (1 - riverBank) * (1 - smoothstep(0.2, 0.4, slope));
    c.lerp(COLORS.sand, sandAmt);
    c.lerp(COLORS.wetSand, (1 - smoothstep(-0.3, 0.7, y)) * (1 - riverBank));
    // The river's gravel shelf, and stones darkened by the water at its edge.
    const gravel = riverBank * (1 - smoothstep(5, 10, edge)) * (1 - smoothstep(1.5, 3, y));
    c.lerp(COLORS.gravel, gravel);
    c.lerp(COLORS.wetStone, riverBank * (1 - smoothstep(-0.2, 0.8, y)));
    c.lerp(COLORS.seabed, 1 - smoothstep(-6, -1, y));
    // Ponds: a carpet of moss around the shore, in patches that reach farther out in places; silt below the water.
    const pe = world.pondEdge(x, z);
    let pondMoss = 0, silt = 0;
    if (pe < 12) {
      pondMoss = (1 - smoothstep(1.5, 4 + 6 * v, pe)) * smoothstep(-0.8, 0.2, pe) * (0.6 + 0.4 * fine);
      silt = 1 - smoothstep(-0.6, 0.1, pe);
      c.lerp(COLORS.pondMoss, pondMoss).lerp(COLORS.silt, silt);
      grass[i] *= smoothstep(0.5, 3, pe) * (1 - 0.6 * pondMoss);
    }

    w.fill(0);
    w[0] = 1;
    toward(earth * 0.9, 2);
    toward(forest, 1);
    toward(steepDirt, 2);
    toward(Math.max(rock, gravel), 3);
    toward(sandAmt, 4);
    toward(pondMoss, 1);
    toward(silt, 2);
    splat.set([w[1], w[2], w[3], w[4]], i * 4);

    // Subtle brightness jitter so flat areas aren't one tone.
    c.multiplyScalar(0.9 + 0.2 * fine);
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aGrass', new THREE.BufferAttribute(grass, 1));
  geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));

  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.95, specularIntensity: 0.15 });
  // Scanned ground textures, when `npm run assets` has fetched them (loaded before the world is built).
  if (groundUniforms.tGroundDiff.value) mat.defines = { USE_GROUND: '' };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, terrainUniforms, groundUniforms, weatherUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aGrass;\nattribute vec4 aSplat;\nvarying float vGrass;\nvarying vec3 vWorld;\nvarying vec4 vSplat;\nvarying vec3 vWorldNormal;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGrass = aGrass;\nvSplat = aSplat;\nvWorld = (modelMatrix * vec4(position, 1.0)).xyz;\nvWorldNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vGrass;
        varying vec3 vWorld;
        varying vec4 vSplat;
        varying vec3 vWorldNormal;
        uniform float uGrassRadius;
        uniform float uWet;
        uniform float uSnow;
        uniform float uRain;
        uniform float uWeatherTime;
        float wetSand = 0.0;
        float puddle = 0.0;
        float rainSheen = 0.0;
        float snowAmt = 0.0;
        ${RAIN_RIPPLES}
        vec3 groundN = vec3(0.0, 1.0, 0.0);
        float groundFade = 0.0;
        #ifdef USE_GROUND
          uniform sampler2DArray tGroundDiff;
          uniform sampler2DArray tGroundNorm;
          uniform vec3 uGroundMean[5];
          uniform float uGroundDetail;
          // Tile frequency per layer (repeats per meter): meadow, forest floor, earth, rock, sand.
          const float GROUND_SCALE[5] = float[5](0.4, 0.33, 0.3, 0.12, 0.35);
          // Whiteout-blended normal for a top-down (xz) projection.
          vec3 topNormal(vec3 tn, vec3 n) {
            vec3 t = vec3(tn.xy + n.xz, abs(tn.z) * n.y);
            return t.xzy;
          }
        #endif
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
        diffuseColor.rgb *= mix(1.0, 0.55, under);
        // Mottling so distant meadow and sand don't read as flat paint.
        float mottle = tNoise(vWorld.xz * 0.35) * 0.6 + tNoise(vWorld.xz * 1.9) * 0.4;
        #ifdef USE_GROUND
          diffuseColor.rgb *= 0.9 + 0.2 * mottle;
          // Splat the scans: each layer's texture over its mean color is the detail multiplied onto the palette.
          // Blending leans on each sample's brightness, so pebbles and leaves poke through at the borders.
          float ws[5] = float[5](max(1.0 - vSplat.x - vSplat.y - vSplat.z - vSplat.w, 0.0), vSplat.x, vSplat.y, vSplat.z, vSplat.w);
          vec3 Nw = normalize(vWorldNormal);
          vec3 tri = pow(abs(Nw), vec3(4.0));
          tri /= tri.x + tri.y + tri.z;
          vec3 detail = vec3(0.0), nSum = vec3(0.0);
          float wSum = 0.0;
          for (int i = 0; i < 5; i++) {
            if (ws[i] < 0.01) continue;
            float layer = float(i), s = GROUND_SCALE[i];
            vec3 c, n;
            if (i == 3) {
              // Rock: triplanar, so cliffs aren't smeared by a top-down projection.
              vec3 cX = texture(tGroundDiff, vec3(vWorld.zy * s, layer)).rgb;
              vec3 cY = texture(tGroundDiff, vec3(vWorld.xz * s, layer)).rgb;
              vec3 cZ = texture(tGroundDiff, vec3(vWorld.xy * s, layer)).rgb;
              c = cX * tri.x + cY * tri.y + cZ * tri.z;
              vec3 nX = texture(tGroundNorm, vec3(vWorld.zy * s, layer)).xyz * 2.0 - 1.0;
              vec3 nY = texture(tGroundNorm, vec3(vWorld.xz * s, layer)).xyz * 2.0 - 1.0;
              vec3 nZ = texture(tGroundNorm, vec3(vWorld.xy * s, layer)).xyz * 2.0 - 1.0;
              nX = vec3(nX.xy + Nw.zy, abs(nX.z) * Nw.x);
              nY = vec3(nY.xy + Nw.xz, abs(nY.z) * Nw.y);
              nZ = vec3(nZ.xy + Nw.xy, abs(nZ.z) * Nw.z);
              n = normalize(nX.zyx * tri.x + nY.xzy * tri.y + nZ.xyz * tri.z);
            } else {
              vec2 uv = vWorld.xz * s;
              // A second, rotated sample at another scale breaks up the tiling.
              vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.37 + 0.31;
              c = mix(texture(tGroundDiff, vec3(uv, layer)).rgb, texture(tGroundDiff, vec3(uv2, layer)).rgb, 0.4);
              n = topNormal(texture(tGroundNorm, vec3(uv, layer)).xyz * 2.0 - 1.0, Nw);
            }
            c /= uGroundMean[i];
            float hw = ws[i] * (0.35 + dot(c, vec3(0.333)));
            detail += c * hw;
            nSum += n * hw;
            wSum += hw;
          }
          detail /= max(wSum, 1e-4);
          // Far away the scans just shimmer; fade them toward the plain palette.
          groundFade = (1.0 - smoothstep(70.0, 260.0, camDist)) * uGroundDetail;
          diffuseColor.rgb *= mix(vec3(1.0), detail, mix(0.3 * uGroundDetail, 1.0, groundFade));
          groundN = normalize(nSum);
        #else
          diffuseColor.rgb *= 0.82 + 0.36 * mottle;
        #endif
        // Bedding on cliff faces: layers of warm ochre and cool grey stone a meter or two thick, gently warped and
        // tilted, with dark seams where one bed overhangs the next. Reads from afar, where the scans have faded.
        {
          float faceY = normalize(vWorldNormal).y;
          float cliff = smoothstep(0.3, 0.65, vSplat.z) * (1.0 - smoothstep(0.5, 0.8, faceY));
          if (cliff > 0.0) {
            float bedY = vWorld.y + (tNoise(vWorld.xz * 0.015) - 0.5) * 9.0 + (tNoise(vWorld.xz * 0.09) - 0.5) * 1.4
              + dot(vWorld.xz, vec2(0.012, -0.008));
            float bedA = tNoise(vec2(bedY * 0.45, 3.7));
            float bedB = tNoise(vec2(bedY * 1.6, 9.1));
            vec3 bed = mix(vec3(1.14, 0.98, 0.82), vec3(0.8, 0.86, 0.94), smoothstep(0.3, 0.7, bedA)) * (0.84 + 0.32 * bedB);
            float seamK = bedY * 0.38 + bedA * 0.6, seamAt = fract(seamK);
            // Some beds part with a deep shadowed seam, others barely show a line.
            float seamDepth = 0.15 + 0.5 * smoothstep(0.3, 0.8, tNoise(vec2(floor(seamK) * 1.7, 5.3)));
            float seam = 1.0 - seamDepth * smoothstep(0.86, 0.95, seamAt) * (1.0 - smoothstep(0.95, 1.0, seamAt));
            diffuseColor.rgb *= mix(vec3(1.0), bed * seam, cliff * 0.85);
          }
        }
        // Beach: wind ripples and grain on dry sand (only where the splat says sand, not on river stones), and a
        // darker band where the water wets the shore.
        float sand = (1.0 - smoothstep(2.0, 3.6, vWorld.y)) * min(vSplat.w * 1.5, 1.0);
        float warp = tNoise(vWorld.xz * 0.08) * 6.0;
        float ripple = 0.5 + 0.5 * sin(dot(vWorld.xz, vec2(0.83, 0.55)) * 4.5 + warp);
        float grain = tNoise(vWorld.xz * 23.0);
        diffuseColor.rgb *= mix(1.0, 0.84 + 0.18 * ripple + 0.12 * (grain - 0.5), sand);
        wetSand = 1.0 - smoothstep(0.2, 1.1, vWorld.y + 0.3 * tNoise(vWorld.xz * 0.5));
        diffuseColor.rgb *= mix(1.0, 0.62, wetSand);
        // Rain: soaked ground darkens, and water gathers in puddles on flat open ground (not under the meadow).
        if (uWet > 0.0) {
          float level = smoothstep(0.96, 0.995, normalize(vWorldNormal).y);
          float hollow = tNoise(vWorld.xz * 0.11 + 3.0) * 0.65 + tNoise(vWorld.xz * 0.43) * 0.35;
          // Only bare ground (paths, dirt, forest floor, beach) shines; under the meadow the wet soil is hidden by
          // the blades, and a glossy floor there reflected the bright sky up between them as a white sheet.
          float open = 1.0 - smoothstep(0.1, 0.4, vGrass);
          puddle = smoothstep(0.62, 0.68, hollow + 0.12 * uWet - 0.12) * level * smoothstep(0.3, 0.8, uWet)
            * open * smoothstep(0.6, 1.2, vWorld.y) * (1.0 - smoothstep(80.0, 160.0, camDist))
            // Not on rock and gravel (vSplat.z): the flattish ledges of a stony hill all turned to mirrors of the sky.
            * (1.0 - smoothstep(0.25, 0.55, vSplat.z));
          diffuseColor.rgb *= mix(1.0, 0.6, uWet * (1.0 - wetSand));
          diffuseColor.rgb *= mix(1.0, 0.35, puddle);
          // Only a whisper of sheen: the ground's strong normal map turned any real gloss (even roughness 0.6) into
          // sparkling white over whole hillsides under a bright evening sky. Darkening carries the wet look.
          rainSheen = uWet * open;
        }
        // Snow settles on whatever faces up: patchy drifts at first, a whole white blanket once it has snowed a while,
        // thin on steep ground, none on cliffs or below the tide line. Snow hides the puddles and the wet.
        if (uSnow > 0.0) {
          float up = normalize(vWorldNormal).y;
          float drift = tNoise(vWorld.xz * 0.21 + 7.0) * 0.6 + tNoise(vWorld.xz * 1.3) * 0.4;
          snowAmt = clamp(uSnow * 1.7 - (1.0 - drift) * 0.7, 0.0, 1.0)
            * smoothstep(0.55, 0.8, up + (drift - 0.5) * 0.25) * smoothstep(0.4, 1.4, vWorld.y);
          // Bluish where the blanket is thin over dark ground, crisp white where it lies deep.
          vec3 snowColor = mix(vec3(0.72, 0.8, 0.92), vec3(0.93, 0.95, 0.99), smoothstep(0.3, 0.9, snowAmt + 0.2 * drift));
          diffuseColor.rgb = mix(diffuseColor.rgb, snowColor, snowAmt);
          puddle *= 1.0 - snowAmt;
          rainSheen *= 1.0 - snowAmt;
          wetSand *= 1.0 - snowAmt;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.35, wetSand);\nroughnessFactor = mix(roughnessFactor, 0.85, rainSheen);\nroughnessFactor = mix(roughnessFactor, 0.03, puddle);\nroughnessFactor = mix(roughnessFactor, 0.8, snowAmt);',
      )
      // Puddles reflect like water: a real F0 and a mirror-flat surface (rings while it rains).
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\nmaterial.specularColor = mix(material.specularColor, vec3(0.02), puddle);\nmaterial.specularF90 = mix(material.specularF90, 1.0, puddle);',
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        #ifdef USE_GROUND
          // Under snow the ground's bumps soften to the blanket's gentle swell.
          normal = normalize(mix(normal, normalize((viewMatrix * vec4(groundN, 0.0)).xyz), groundFade * (1.0 - 0.75 * snowAmt)));
        #endif
        if (puddle > 0.0) {
          vec2 rr = rainRipples(vWorld.xz, uWeatherTime) * uRain * 0.25;
          vec3 pn = normalize(vec3(-rr.x, 1.0, -rr.y));
          normal = normalize(mix(normal, normalize((viewMatrix * vec4(pn, 0.0)).xyz), puddle));
        }`,
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  return mesh;
}
