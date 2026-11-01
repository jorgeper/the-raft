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
