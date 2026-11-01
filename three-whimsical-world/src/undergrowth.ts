import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Procedural undergrowth for the ground-cover scatter: mushrooms, reeds with cattails, and berry shrubs.
 * Each geometry has vertex colors for its green or pale parts and an `aHead` attribute marking the parts that
 * take the per-instance color instead (mushroom caps, berries), so one instanced draw shows many species.
 */

/** Sets a uniform vertex color and `aHead` flag on a geometry (non-indexed or indexed). */
function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, head: number) {
  const n = geo.attributes.position.count;
  const c = new THREE.Color(color);
  geo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n).fill(0).flatMap(() => [c.r, c.g, c.b]), 3));
  geo.setAttribute('aHead', new THREE.Float32BufferAttribute(new Array(n).fill(head), 1));
  geo.deleteAttribute('uv');
  return geo;
}

/** One mushroom about 18 cm tall: a pale stem and a domed cap (the cap takes the instance color). */
export function createMushroomGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  // A main mushroom and two smaller ones beside it, like a little cluster.
  const specs = [
    { x: 0, z: 0, s: 1 },
    { x: 0.09, z: 0.05, s: 0.62 },
    { x: -0.06, z: 0.08, s: 0.45 },
  ];
  for (const { x, z, s } of specs) {
    const stem = new THREE.CylinderGeometry(0.018 * s, 0.026 * s, 0.14 * s, 7, 1, true);
    stem.translate(x, 0.07 * s, z);
    parts.push(paint(stem, '#e8dfcc', 0));
    const cap = new THREE.SphereGeometry(0.075 * s, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
    cap.scale(1, 0.6, 1);
    cap.translate(x, 0.125 * s, z);
    parts.push(paint(cap, '#ffffff', 1));
    // The pale gills under the cap.
    const gills = new THREE.CircleGeometry(0.07 * s, 12);
    gills.rotateX(Math.PI / 2);
    gills.translate(x, 0.128 * s, z);
    parts.push(paint(gills, '#d8ccb0', 0));
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

/** A clump of reeds: tall thin leaves arching out, and a few cattails on stiff stalks. */
export function createReedGeometry() {
  const positions: number[] = [], colors: number[] = [], heads: number[] = [];
  const green = new THREE.Color('#5e7a2a'), tip = new THREE.Color('#b8b45a'), brown = new THREE.Color('#5a3a20');
  const rand = (() => {
    let s = 7;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();
  const c = new THREE.Color();
  const blade = (angle: number, height: number, lean: number, width: number) => {
    const segs = 5, dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)), side = new THREE.Vector3(-dir.z, 0, dir.x);
    const ring: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const centre = dir.clone().multiplyScalar(lean * t * t).setY(height * t);
      const w = width * (1 - t * 0.9);
      ring.push(centre.clone().addScaledVector(side, -w), centre.clone().addScaledVector(side, w));
    }
    for (let i = 0; i < segs; i++) {
      const [a, b, cc, d] = [ring[i * 2], ring[i * 2 + 1], ring[i * 2 + 2], ring[i * 2 + 3]];
      for (const v of [a, b, cc, b, d, cc]) {
        positions.push(v.x, v.y, v.z);
        c.copy(green).lerp(tip, Math.pow(v.y / height, 1.5));
        colors.push(c.r, c.g, c.b);
        heads.push(0);
      }
    }
  };
  for (let i = 0; i < 14; i++) blade(rand() * Math.PI * 2, 0.9 + rand() * 0.8, 0.15 + rand() * 0.45, 0.012 + rand() * 0.01);
  const parts: THREE.BufferGeometry[] = [];
  const own = new THREE.BufferGeometry();
  own.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  own.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  own.setAttribute('aHead', new THREE.Float32BufferAttribute(heads, 1));
  parts.push(own);
  for (let k = 0; k < 3; k++) {
    const a = rand() * Math.PI * 2, r = 0.05 + rand() * 0.08, h = 1.3 + rand() * 0.5;
    const stalk = new THREE.CylinderGeometry(0.005, 0.007, h, 4, 1, true);
    stalk.translate(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    parts.push(paint(stalk, green, 0).toNonIndexed());
    const head = new THREE.CapsuleGeometry(0.018, 0.13, 3, 6);
    head.translate(Math.cos(a) * r, h - 0.12, Math.sin(a) * r);
    parts.push(paint(head, brown, 0).toNonIndexed());
  }
  for (const part of parts) part.deleteAttribute('normal');
  const geo = mergeGeometries(parts)!;
  geo.computeVertexNormals();
  // Leaves shade as a soft clump, not edge-on cards.
  const n = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.4, 0.9, n.getZ(i) * 0.4);
  geo.normalizeNormals();
  return geo;
}

/** A leaf for the shrub, as an alpha texture (white: the leaf takes the vertex color). */
export function createShrubLeafTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  // A sprig of small pointed leaves per card, so a few dozen cards make a full-looking shrub.
  for (const [x, y, r] of [[22, 24, 0.4], [42, 30, -0.5], [30, 46, 0.1], [14, 44, 0.9], [48, 50, -1.0], [34, 12, -0.2]]) {
    g.save();
    g.translate(x, y);
    g.rotate(r);
    g.beginPath();
    g.moveTo(0, -12);
    g.quadraticCurveTo(9, 0, 0, 12);
    g.quadraticCurveTo(-9, 0, 0, -12);
    g.fill();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A low berry shrub (raspberry, blueberry, lingonberry): a mound of leaf cards dotted with berries. */
export function createShrubGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  let s = 11;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const leaf = new THREE.Color();
  for (let i = 0; i < 70; i++) {
    const card = new THREE.PlaneGeometry(0.2, 0.2);
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 0.32;
    const y = 0.08 + (1 - r / 0.32) * 0.28 + rand() * 0.08;
    card.rotateX(-Math.PI / 2 + (rand() - 0.5) * 1.2);
    card.rotateY(rand() * Math.PI * 2);
    card.translate(Math.cos(a) * r, y, Math.sin(a) * r);
    leaf.setHSL(0.27 + rand() * 0.05, 0.5, 0.24 + rand() * 0.1, THREE.SRGBColorSpace);
    paint(card, leaf, 0);
    card.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
    parts.push(card.toNonIndexed());
  }
  // Berries sit on the outside of the mound.
  for (let i = 0; i < 30; i++) {
    const berry = new THREE.IcosahedronGeometry(0.016 + rand() * 0.008, 0);
    const a = rand() * Math.PI * 2, r = 0.1 + rand() * 0.24;
    berry.translate(Math.cos(a) * r, 0.1 + (1 - r / 0.34) * 0.3 + rand() * 0.05, Math.sin(a) * r);
    paint(berry, '#ffffff', 1);
    // Berries sample the leaf texture's opaque middle.
    berry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(berry.attributes.position.count * 2).fill(0).map((_, k) => (k % 2 ? 0.62 : 0.34)), 2));
    parts.push(berry.toNonIndexed());
  }
  const geo = mergeGeometries(parts)!;
  // Mostly-up normals: the shrub shades as one leafy mass.
  const n = geo.attributes.normal as THREE.BufferAttribute;
  const p = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, p.getX(i) * 1.5, 1, p.getZ(i) * 1.5);
  geo.normalizeNormals();
  return geo;
}

/**
 * Makes a vertex-colored instanced material use the instance color only on `aHead` parts; with `spots`, red
 * caps (the fly agaric) get white flecks.
 */
export function headColored(material: THREE.Material, spots = false) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev.call(material, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aHead;\nvarying float vSpotty;\nvarying vec3 vLocal;')
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        vSpotty = 0.0;
        vLocal = position;
        #if defined(USE_INSTANCING_COLOR) && defined(USE_COLOR)
          vColor.rgb = color.rgb * mix(vec3(1.0), instanceColor.rgb, aHead);
          vSpotty = aHead * step(0.5, instanceColor.r) * step(instanceColor.g, 0.35);
        #endif`,
      );
    if (spots) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vSpotty;\nvarying vec3 vLocal;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          if (vSpotty > 0.5) {
            vec3 q = vLocal * 60.0;
            float h = fract(sin(dot(floor(q), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            float d = length(fract(q) - 0.5);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.92, 0.85), step(0.72, h) * step(d, 0.38));
          }`,
        );
    }
  };
}

/** A seeded random generator for repeatable geometry. */
function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** Builds a non-indexed geometry from flat triangle lists (positions, colors, head flags); normals bend up. */
function fromTriangles(positions: number[], colors: number[], heads: number[], upBend = 0.6) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('aHead', new THREE.Float32BufferAttribute(heads, 1));
  geo.computeVertexNormals();
  // Thin parts shade as a soft clump, not as edge-on cards.
  const n = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * (1 - upBend), 1, n.getZ(i) * (1 - upBend));
  geo.normalizeNormals();
  return geo;
}

/** A tapering stalk as a crossed pair of thin strips from `base` up to `top`. */
function stalk(out: { p: number[]; c: number[]; h: number[] }, base: THREE.Vector3, top: THREE.Vector3, width: number, color: THREE.Color) {
  for (const [sx, sz] of [[1, 0], [0, 1]]) {
    const a = [base.x - sx * width, base.y, base.z - sz * width], b = [base.x + sx * width, base.y, base.z + sz * width];
    const t = [top.x, top.y, top.z];
    out.p.push(...a, ...b, ...t);
    for (let i = 0; i < 3; i++) out.c.push(color.r, color.g, color.b), out.h.push(0);
  }
}

/**
 * Tall meadow wildflowers on spikes (fireweed): a few stems about a meter tall, each topped by a tapering spike of
 * florets that take the instance color, with leaves along the stem. They rise above the grass so drifts of
 * color read from afar.
 */
export function createSpikeFlowerGeometry() {
  const out = { p: [] as number[], c: [] as number[], h: [] as number[] };
  const rand = seeded(5);
  const stem = new THREE.Color('#4a6a26'), leaf = new THREE.Color('#3e5e20'), bud = new THREE.Color('#ffffff');
  for (let k = 0; k < 4; k++) {
    const a = rand() * Math.PI * 2, r = k === 0 ? 0 : 0.05 + rand() * 0.07;
    const height = 0.75 + rand() * 0.45;
    const base = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    const top = base.clone().add(new THREE.Vector3((rand() - 0.5) * 0.08, height, (rand() - 0.5) * 0.08));
    stalk(out, base, top, 0.006, stem);
    // Narrow willow-like leaves angled up along the lower stem.
    for (let i = 0; i < 6; i++) {
      const t = 0.15 + i * 0.09, la = rand() * Math.PI * 2, len = 0.11 + rand() * 0.05;
      const p0 = base.clone().lerp(top, t);
      const dir = new THREE.Vector3(Math.cos(la), 0.7, Math.sin(la)).normalize();
      const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(0.012);
      const tip = p0.clone().addScaledVector(dir, len);
      out.p.push(...p0.clone().add(side).toArray(), ...p0.clone().sub(side).toArray(), ...tip.toArray());
      for (let j = 0; j < 3; j++) out.c.push(leaf.r, leaf.g, leaf.b), out.h.push(0);
    }
    // The spike: florets in a spiral, wider at the bottom, the top third still in bud.
    const spikeLen = 0.22 + rand() * 0.1;
    for (let i = 0; i < 26; i++) {
      const t = i / 26;
      const y = top.y - spikeLen + t * spikeLen;
      const ring = 0.035 * (1 - t) + 0.006;
      const fa = i * 2.4 + rand();
      const center = new THREE.Vector3(top.x + Math.cos(fa) * ring, y, top.z + Math.sin(fa) * ring);
      const s = 0.022 * (1 - 0.6 * t);
      const out1 = new THREE.Vector3(Math.cos(fa), 0.3, Math.sin(fa)).normalize().multiplyScalar(s);
      const up = new THREE.Vector3(0, s, 0);
      // Two petals per floret, as a small open diamond facing out.
      out.p.push(...center.toArray(), ...center.clone().add(out1).add(up).toArray(), ...center.clone().add(out1).sub(up.clone().multiplyScalar(0.3)).toArray());
      const side = new THREE.Vector3(-out1.z, 0, out1.x);
      out.p.push(...center.toArray(), ...center.clone().add(side).add(up.clone().multiplyScalar(0.6)).toArray(), ...center.clone().sub(side).add(up.clone().multiplyScalar(0.6)).toArray());
      // Buds at the tip are darker.
      const shade = t > 0.7 ? 0.6 : 1;
      for (let j = 0; j < 6; j++) out.c.push(bud.r * shade, bud.g * shade, bud.b * shade), out.h.push(1);
    }
  }
  return fromTriangles(out.p, out.c, out.h, 0.5);
}

/** Yarrow / meadowsweet: stems with flat umbrella heads of tiny florets (cream, white, pale pink). */
export function createUmbelGeometry() {
  const out = { p: [] as number[], c: [] as number[], h: [] as number[] };
  const rand = seeded(9);
  const stem = new THREE.Color('#56702e'), white = new THREE.Color('#ffffff');
  for (let k = 0; k < 3; k++) {
    const a = rand() * Math.PI * 2, r = k === 0 ? 0 : 0.06 + rand() * 0.06;
    const base = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    const top = base.clone().add(new THREE.Vector3((rand() - 0.5) * 0.1, 0.6 + rand() * 0.3, (rand() - 0.5) * 0.1));
    stalk(out, base, top, 0.005, stem);
    // A domed cluster of florets, each a tiny upward-facing triangle.
    for (let i = 0; i < 40; i++) {
      const fr = Math.sqrt(rand()) * 0.07, fa = rand() * Math.PI * 2;
      const c = new THREE.Vector3(top.x + Math.cos(fa) * fr, top.y + 0.015 * (1 - (fr / 0.07) ** 2), top.z + Math.sin(fa) * fr);
      const s = 0.012;
      out.p.push(c.x - s, c.y, c.z - s * 0.6, c.x + s, c.y, c.z - s * 0.6, c.x, c.y + 0.003, c.z + s);
      for (let j = 0; j < 3; j++) out.c.push(white.r, white.g, white.b), out.h.push(1);
    }
  }
  return fromTriangles(out.p, out.c, out.h, 0.85);
}

/** A tuft of tall seeding grass: long arching blades and a few stalks with drooping oat-like seed heads. */
export function createSeedGrassGeometry() {
  const out = { p: [] as number[], c: [] as number[], h: [] as number[] };
  const rand = seeded(13);
  const green = new THREE.Color('#5a7a2c'), tip = new THREE.Color('#c8b864'), straw = new THREE.Color('#d8c27a');
  const c = new THREE.Color();
  // Blades: like the reeds but softer and more arched.
  for (let i = 0; i < 16; i++) {
    const angle = rand() * Math.PI * 2, height = 0.55 + rand() * 0.45, lean = 0.2 + rand() * 0.35, width = 0.008 + rand() * 0.006;
    const dir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)), side = new THREE.Vector3(-dir.z, 0, dir.x);
    const ring: THREE.Vector3[] = [];
    for (let s = 0; s <= 4; s++) {
      const t = s / 4;
      const centre = dir.clone().multiplyScalar(lean * t * t).setY(height * t * (1 - 0.25 * t * t));
      const w = width * (1 - t * 0.9);
      ring.push(centre.clone().addScaledVector(side, -w), centre.clone().addScaledVector(side, w));
    }
    for (let s = 0; s < 4; s++) {
      const quad = [ring[s * 2], ring[s * 2 + 1], ring[s * 2 + 2], ring[s * 2 + 1], ring[s * 2 + 3], ring[s * 2 + 2]];
      for (const v of quad) {
        out.p.push(v.x, v.y, v.z);
        c.copy(green).lerp(tip, Math.pow(Math.max(v.y, 0) / height, 2));
        out.c.push(c.r, c.g, c.b);
        out.h.push(0);
      }
    }
  }
  // Seed stalks rising above the blades, each with a nodding panicle of spikelets.
  for (let k = 0; k < 5; k++) {
    const a = rand() * Math.PI * 2, r = 0.03 + rand() * 0.05;
    const base = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    const top = base.clone().add(new THREE.Vector3(Math.cos(a) * 0.12, 0.95 + rand() * 0.35, Math.sin(a) * 0.12));
    stalk(out, base, top, 0.004, straw);
    for (let i = 0; i < 10; i++) {
      const t = i / 10;
      const p0 = new THREE.Vector3(top.x, top.y - t * 0.18, top.z);
      const sa = rand() * Math.PI * 2;
      const tipP = p0.clone().add(new THREE.Vector3(Math.cos(sa) * 0.04, -0.05, Math.sin(sa) * 0.04));
      const w = new THREE.Vector3(-Math.sin(sa), 0, Math.cos(sa)).multiplyScalar(0.006);
      out.p.push(...p0.clone().add(w).toArray(), ...p0.clone().sub(w).toArray(), ...tipP.toArray());
      for (let j = 0; j < 3; j++) out.c.push(1, 1, 1), out.h.push(1);
    }
  }
  return fromTriangles(out.p, out.c, out.h, 0.6);
}

/** Dandelion seed clocks: thin stems with a fluffy white ball (three crossed cards with a radial fluff texture). */
export function createDandelionClockGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const rand = seeded(17);
  for (let k = 0; k < 3; k++) {
    const a = rand() * Math.PI * 2, r = k === 0 ? 0 : 0.05 + rand() * 0.05;
    const h = 0.55 + rand() * 0.3;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const stem = new THREE.CylinderGeometry(0.003, 0.004, h, 4, 1, true);
    stem.translate(x, h / 2, z);
    paint(stem, '#6a8a3a', 0);
    stem.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(stem.attributes.position.count * 2).fill(0.5), 2));
    parts.push(stem.toNonIndexed());
    for (let i = 0; i < 3; i++) {
      const card = new THREE.PlaneGeometry(0.075, 0.075);
      if (i === 1) card.rotateY(Math.PI / 3);
      if (i === 2) card.rotateY(-Math.PI / 3);
      card.rotateX((rand() - 0.5) * 0.4);
      card.translate(x, h + 0.02, z);
      paint(card, '#ffffff', 1);
      card.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
      parts.push(card.toNonIndexed());
    }
  }
  const geo = mergeGeometries(parts)!;
  const n = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.3, 1, n.getZ(i) * 0.3);
  geo.normalizeNormals();
  return geo;
}

/** The seed clock's fluff: fine radiating filaments with tufted tips, dense in the middle (white on transparent). */
export function createFluffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const rand = seeded(23);
  g.translate(64, 64);
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 1;
  for (let i = 0; i < 140; i++) {
    const a = rand() * Math.PI * 2, len = 40 + rand() * 20;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    g.stroke();
    // Each seed's parachute: a little starburst at the tip.
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.arc(Math.cos(a) * len, Math.sin(a) * len, 2 + rand() * 1.5, 0, Math.PI * 2);
    g.fill();
  }
  // The seed head in the middle.
  g.fillStyle = '#e8e2c8';
  g.beginPath();
  g.arc(0, 0, 7, 0, Math.PI * 2);
  g.fill();
  // The stems sample the opaque seed head at the center.
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A cushion of moss: a low lumpy mound, bright yellow-green where it faces the sky, darker down its sides. */
export function createMossGeometry() {
  const geo = new THREE.IcosahedronGeometry(0.5, 3);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const top = new THREE.Color('#6a8a26'), side = new THREE.Color('#304616'), c = new THREE.Color();
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // Lumps, then squash to a cushion that sinks a little into the ground.
    const lump = 1 + 0.18 * Math.sin(x * 9.1 + z * 4.3) * Math.cos(z * 7.7 - x * 3.1) + 0.08 * Math.sin(y * 17 + x * 11);
    x *= lump;
    z *= lump;
    y = Math.max(y * lump, -0.1) * 0.32 - 0.02;
    pos.setXYZ(i, x, y, z);
    c.copy(side).lerp(top, THREE.MathUtils.smoothstep(y, -0.02, 0.15));
    c.multiplyScalar(0.9 + 0.2 * Math.sin(x * 23 + z * 19));
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aHead', new THREE.Float32BufferAttribute(new Array(pos.count).fill(0), 1));
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  return geo;
}

/** Fallen leaves and spruce needles, as an alpha texture with its own colors (warm browns, ochre, a few reds). */
export function createLitterTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const rand = seeded(29);
  const leafColors = ['#8a5a2a', '#a8742e', '#6e4422', '#b88a3a', '#94401e', '#5e4a26', '#c09040'];
  // Needles first, underneath: short thin strokes.
  g.lineCap = 'round';
  for (let i = 0; i < 700; i++) {
    const x = 20 + rand() * 216, y = 20 + rand() * 216, a = rand() * Math.PI;
    if (Math.hypot(x - 128, y - 128) > 110 + rand() * 10) continue;
    g.strokeStyle = rand() < 0.5 ? '#6a4a2a' : '#8a6438';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9);
    g.stroke();
  }
  // Leaves on top: rounded, pointed shapes with a midrib.
  for (let i = 0; i < 70; i++) {
    const x = 30 + rand() * 196, y = 30 + rand() * 196;
    if (Math.hypot(x - 128, y - 128) > 100) continue;
    const s = 7 + rand() * 7;
    g.save();
    g.translate(x, y);
    g.rotate(rand() * Math.PI * 2);
    g.fillStyle = leafColors[Math.floor(rand() * leafColors.length)];
    g.beginPath();
    g.moveTo(0, -s);
    g.quadraticCurveTo(s * 0.8, 0, 0, s);
    g.quadraticCurveTo(-s * 0.8, 0, 0, -s);
    g.fill();
    g.strokeStyle = 'rgba(40,24,10,0.5)';
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(0, -s);
    g.lineTo(0, s);
    g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A flat card of litter lying just above the ground (instances add a slight tilt and any yaw). */
export function createLitterGeometry() {
  const geo = new THREE.PlaneGeometry(1.1, 1.1);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0.06, 0);
  return geo;
}
