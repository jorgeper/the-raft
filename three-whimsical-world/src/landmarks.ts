import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { createFracturedRockMaterial } from './fractured-rocks';
import { mulberry32, type WorldFns } from './worldgen';

/** Rune stone size (m): the slab's half width, its height above the ground, and its thickness. */
const HALF_W = 0.58, TALL = 2.35, THICK = 0.36, SINK = 0.35;

/**
 * A rune stone slab: a rounded-top block of granite, its carved face toward local +z. The face stays fairly flat (the
 * carving is drawn on it); the back and edges are lumpier.
 */
function runeStoneGeometry(seed: number) {
  const g = new THREE.BoxGeometry(HALF_W * 2, TALL + SINK, THICK, 14, 34, 4);
  g.translate(0, (TALL + SINK) / 2 - SINK, 0);
  const noise = createNoise3D(mulberry32(seed));
  const pos = g.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const up = Math.max(v.y, 0) / TALL;
    // Shoulders round off toward the top, the slab narrows a little and the top arches.
    const nx = v.x / HALF_W;
    const top = TALL - 0.42 * nx * nx;
    if (v.y > 0) v.y *= top / TALL;
    v.x *= 1 - 0.12 * up * up + 0.05 * noise(seed, v.y * 0.6, 0);
    v.z *= 1 - 0.25 * up;
    const front = v.z > 0 ? 0.25 : 1;
    const lump = noise(v.x * 1.6, v.y * 1.6, v.z * 1.6) * 0.035 + noise(v.x * 5, v.y * 5, v.z * 5) * 0.01;
    v.x += lump * Math.sign(v.x) * front;
    v.z += lump * Math.sign(v.z) * front;
    if (v.y > top - 0.05) v.y += lump;
    pos.setXYZ(i, v.x, v.y, v.z);
    const c = 0.5 + noise(v.x * 2.2 + 9, v.y * 2.2, v.z * 2.2) * 0.06;
    colors.set([c, c * 0.98, c * 0.95], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * The carving, drawn on the face: a serpent band arching around the face with runes inside its body, a cross knot in
 * the middle. Grooves are dark and shade like real cuts; the serpent's body and the runes keep traces of red paint.
 */
const CARVING = /* glsl */ `
  float runeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float runeNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(runeHash(i), runeHash(i + vec2(1, 0)), f.x), mix(runeHash(i + vec2(0, 1)), runeHash(i + vec2(1, 1)), f.x), f.y);
  }
  float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
  }
  // Groove depth (0..1) at a point on the face, in meters from the face's base center; and in 'paint' the painted
  // area (the serpent's body).
  float carve(vec2 p, float seed, out float paint) {
    vec2 c = vec2(0.0, 1.12);
    vec2 radii = vec2(0.4, 0.86);
    vec2 q = (p - c) / radii;
    float r = length(q);
    float d = (r - 1.0) * 0.5 * (radii.x + radii.y);
    // The band ends at the serpent's head (left) and tail (right), low on the stone.
    float open = smoothstep(0.32, 0.42, p.y);
    float body = (1.0 - smoothstep(0.075, 0.085, abs(d))) * open;
    float edge = (1.0 - smoothstep(0.009, 0.017, abs(abs(d) - 0.08))) * open;
    // The head: a teardrop where the band ends on the left, with an eye.
    vec2 head = vec2(-radii.x, 0.38);
    float hd = length((p - head) * vec2(1.0, 0.75));
    body = max(body, 1.0 - smoothstep(0.1, 0.11, hd));
    edge = max(edge, 1.0 - smoothstep(0.009, 0.017, abs(hd - 0.105)));
    float eye = 1.0 - smoothstep(0.012, 0.022, length(p - head - vec2(0.02, 0.03)));
    // Runes along the body: a stave across the band and hashed twigs.
    float ang = atan(q.x, q.y);
    float cells = 26.0;
    float u = ang / 6.28318 * cells;
    float cell = floor(u);
    vec2 g = vec2(fract(u) - 0.5, d / 0.06);
    float h = runeHash(vec2(cell, seed));
    float rune = 1.0 - smoothstep(0.06, 0.12, abs(g.x - 0.0) * 1.2) * 1.0;
    rune *= step(abs(g.y), 0.9);
    float tw = 9.0;
    for (int k = 0; k < 2; k++) {
      float hk = runeHash(vec2(cell, seed + float(k) * 7.3));
      if (hk < 0.25) continue;
      float y0 = (hk - 0.6) * 1.6;
      float side = hk > 0.62 ? 1.0 : -1.0;
      vec2 a = vec2(0.0, y0), b = vec2(side * 0.32, y0 + (hash12k(hk) - 0.5) * 1.4);
      tw = min(tw, segDist(g * vec2(1.0, 0.45), a * vec2(1.0, 0.45), b * vec2(1.0, 0.45)));
    }
    rune = max(rune, 1.0 - smoothstep(0.035, 0.07, tw));
    // Word dividers: every few cells a pair of dots instead.
    if (h < 0.14) rune = (1.0 - smoothstep(0.05, 0.09, length(vec2(g.x, abs(g.y) - 0.35) * vec2(1.0, 0.5))));
    rune *= body * step(0.0, ang + 2.75) * step(ang, 2.75);
    // A ring cross in the middle.
    vec2 m = p - vec2(0.0, 1.2);
    float cross = min(abs(m.x), abs(m.y)) < 0.022 && max(abs(m.x), abs(m.y)) < 0.2 ? 1.0 : 0.0;
    cross = max(cross, 1.0 - smoothstep(0.009, 0.017, abs(length(m) - 0.11)));
    paint = body;
    return clamp(max(max(edge, rune), max(cross, eye)), 0.0, 1.0);
  }
  float hash12k(float x) { return fract(sin(x * 91.7) * 4375.3); }
`;

function createRuneStoneMaterial() {
  const material = createFracturedRockMaterial();
  const base = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    base.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRuneLocal;\nvarying vec3 vRuneX;\nvarying vec3 vRuneY;\nvarying float vRuneSeed;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vRuneLocal = position;
        vRuneSeed = floor(fract(modelMatrix[3].x * 0.131 + modelMatrix[3].z * 0.0713) * 97.0);
        vRuneX = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        vRuneY = normalize((modelViewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vRuneLocal;
        varying vec3 vRuneX;
        varying vec3 vRuneY;
        varying float vRuneSeed;
        float hash12k(float x);
        ${CARVING}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        if (vRuneLocal.z > ${(THICK * 0.2).toFixed(3)}) {
          vec2 fp = vRuneLocal.xy;
          float paint, pdx, pdy;
          float cut = carve(fp, vRuneSeed, paint);
          float cx = carve(fp + vec2(0.006, 0.0), vRuneSeed, pdx);
          float cy = carve(fp + vec2(0.0, 0.006), vRuneSeed, pdy);
          // The grooves tilt the normal like a V cut and sit in their own shade.
          normal = normalize(normal + (vRuneX * (cx - cut) + vRuneY * (cy - cut)) * 3.5);
          float wear = smoothstep(0.3, 0.7, runeNoise(fp * 9.0 + vRuneSeed) * 0.6 + runeNoise(fp * 38.0) * 0.4);
          vec3 red = vec3(0.42, 0.075, 0.045);
          diffuseColor.rgb = mix(diffuseColor.rgb, red, paint * (1.0 - cut) * wear * 0.75);
          diffuseColor.rgb *= 1.0 - cut * 0.55;
        }`,
      );
    material.userData.shader = shader;
  };
  const key = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => key() + '-runestone';
  return material;
}

/** Rune stones from worldgen's landmarks (the stone circles are part of the rocks; the mounds part of the land). */
export function createLandmarks(world: WorldFns) {
  const group = new THREE.Group();
  const geometries = [runeStoneGeometry(world.params.seed * 7 + 1), runeStoneGeometry(world.params.seed * 7 + 2)];
  const material = createRuneStoneMaterial();
  const rand = mulberry32(world.params.seed * 61 + 7);
  let n = 0;
  for (const l of world.landmarks) {
    if (l.kind !== 'runestone') continue;
    const mesh = new THREE.Mesh(geometries[n++ % 2], material);
    const lean = (rand() - 0.5) * 0.08;
    const scale = 0.9 + rand() * 0.25;
    // Settle it on the lowest ground under its footprint, so no edge floats on a slope.
    let y = Infinity;
    for (const [dx, dz] of [[-0.5, -0.2], [0.5, -0.2], [-0.5, 0.2], [0.5, 0.2], [0, 0]]) {
      y = Math.min(y, world.height(l.x + dx, l.z + dz));
    }
    mesh.position.set(l.x, y, l.z);
    mesh.rotation.set(lean, l.yaw, (rand() - 0.5) * 0.06, 'YXZ');
    mesh.scale.setScalar(scale);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
