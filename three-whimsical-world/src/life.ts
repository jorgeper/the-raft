import * as THREE from 'three';
import type { WorldFns } from './worldgen';
import { quality } from './quality';
import { seasonUniforms } from './season';
import { weatherUniforms } from './weather';

/**
 * Small life that makes the land feel inhabited: butterflies over the meadow flowers, birds wheeling high
 * overhead, and leaves drifting down under the trees. Each is one instanced draw whose motion runs in the vertex
 * shader; the CPU only moves anchors around the viewer now and then.
 */

/** Draws a simple wing shape (both wings, mirrored) into an alpha texture: dark veined edges, bright middle. */
function createWingTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  // Right half only (the geometry mirrors it): a big forewing and a smaller hindwing.
  const wing = (path: () => void, fill: string) => {
    g.beginPath();
    path();
    g.fillStyle = fill;
    g.fill();
  };
  const fore = () => g.ellipse(48, 46, 46, 30, -0.5, 0, Math.PI * 2);
  const hind = () => g.ellipse(40, 90, 30, 26, 0.5, 0, Math.PI * 2);
  wing(fore, '#202020');
  wing(hind, '#202020');
  g.save();
  g.scale(0.82, 0.8);
  g.translate(8, 10);
  wing(fore, '#ffffff');
  wing(hind, '#f4f4f4');
  g.restore();
  // Eye spots.
  g.fillStyle = '#303030';
  g.beginPath();
  g.arc(70, 34, 6, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A leaf silhouette for the falling leaves. */
function createLeafTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(32, 2);
  g.quadraticCurveTo(62, 30, 32, 62);
  g.quadraticCurveTo(2, 30, 32, 2);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(32, 6);
  g.lineTo(32, 60);
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const BUTTERFLIES = 48;
const BIRDS = 14;
const LEAVES = 700;
const LEAF_BOX = 30;

/** GLSL: rotation of v about the y axis. */
const rotY = /* glsl */ `
  vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
`;

export class Life {
  readonly group = new THREE.Group();
  private uniforms = {
    uTime: { value: 0 },
    uDay: { value: 1 },
    uCam: { value: new THREE.Vector3() },
    /** How wooded it is around the viewer: falling leaves only show under trees. */
    uLeafAmount: { value: 0 },
  };
  private butterflies: THREE.InstancedMesh;
  private birds: THREE.InstancedMesh;
  private leaves: THREE.InstancedMesh;
  private anchors: THREE.Vector3[] = [];
  private flocks: { center: THREE.Vector3; until: number }[] = [];
  private rand = Math.random;
  private matrix = new THREE.Matrix4();
  private disposables: { dispose(): void }[] = [];

  constructor(private world: WorldFns) {
    this.butterflies = this.createButterflies();
    this.birds = this.createBirds();
    this.leaves = this.createLeaves();
    this.group.add(this.butterflies, this.birds, this.leaves);
  }

  /** Patches a lit material's vertex stage with `body` (GLSL that may edit `transformed`, with instance data). */
  private animate(material: THREE.Material, decls: string, body: string) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform float uTime;
          uniform float uDay;
          uniform vec3 uCam;
          uniform float uLeafAmount;
          ${rotY}
          ${decls}`,
        )
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${body}`);
    };
  }

  private createButterflies() {
    // Two wings hinged along the body (z axis).
    const geo = new THREE.BufferGeometry();
    const s = 0.07;
    const pos = [0, 0, -s, s * 2, 0, -s, s * 2, 0, s, 0, 0, s];
    const p: number[] = [], uv: number[] = [], idx: number[] = [];
    for (const k of [-1, 1]) {
      const base = p.length / 3;
      for (let i = 0; i < 4; i++) {
        p.push(pos[i * 3] * k, pos[i * 3 + 1], pos[i * 3 + 2]);
        uv.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 1 : 0);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(p.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    geo.setIndex(idx);
    const seeds = new Float32Array(BUTTERFLIES * 4).map(() => Math.random());
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));

    const map = createWingTexture();
    const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 });
    this.animate(
      mat,
      'attribute vec4 aSeed;',
      /* glsl */ `
        // Flutter: wings beat fast, with short glides.
        float t = uTime * (0.8 + 0.4 * aSeed.x) + aSeed.y * 100.0;
        float beat = sin(uTime * (14.0 + 6.0 * aSeed.z) + aSeed.w * 30.0);
        float glide = smoothstep(0.6, 0.9, sin(t * 0.7));
        float flap = mix(beat * 1.1, 0.35, glide);
        // Both wings swing up together about the body axis.
        transformed = vec3(transformed.x * cos(flap), abs(transformed.x) * sin(flap), transformed.z);
        // A looping, wandering path around the anchor, bobbing up and down.
        vec3 p0 = vec3(sin(t * 0.37) * 3.0 + sin(t * 0.91) * 1.2, sin(t * 2.3) * 0.18 + sin(t * 0.5) * 0.25, cos(t * 0.29) * 3.0 + cos(t * 1.13) * 1.0);
        vec3 p1 = vec3(sin((t + 0.05) * 0.37) * 3.0 + sin((t + 0.05) * 0.91) * 1.2, 0.0, cos((t + 0.05) * 0.29) * 3.0 + cos((t + 0.05) * 1.13) * 1.0);
        vec2 dir = normalize(p1.xz - p0.xz + 1e-4);
        transformed = rotY(transformed, atan(dir.x, dir.y)) + p0;
        transformed *= step(0.5, uDay);
      `,
    );
    const mesh = new THREE.InstancedMesh(geo, mat, BUTTERFLIES);
    const colors = ['#ff9a2e', '#ffd84a', '#f6f2e8', '#7fb6ff', '#ff7f50', '#ffe680'].map((c) => new THREE.Color(c));
    for (let i = 0; i < BUTTERFLIES; i++) {
      mesh.setColorAt(i, colors[i % colors.length]);
      this.anchors.push(new THREE.Vector3(1e6, 0, 1e6));
    }
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    this.disposables.push(geo, mat, map);
    return mesh;
  }

  private createBirds() {
    // A body with two wings (each two triangles, bending at the elbow); aWing marks side, aOuter the wingtip half.
    const p: number[] = [], wing: number[] = [], outer: number[] = [];
    const tri = (a: number[], b: number[], c: number[], side: number, o: number[]) => {
      p.push(...a, ...b, ...c);
      wing.push(side, side, side);
      outer.push(...o);
    };
    for (const k of [-1, 1]) {
      tri([0, 0, 0.25], [0.45 * k, 0, 0.05], [0, 0, -0.2], k, [0, 0, 0]);
      tri([0.45 * k, 0, 0.05], [1.0 * k, 0, -0.15], [0.4 * k, 0, -0.18], k, [0, 1, 0]);
      tri([0.45 * k, 0, 0.05], [0.4 * k, 0, -0.18], [0, 0, -0.2], k, [0, 0, 0]);
    }
    // Tail.
    tri([0, 0, -0.2], [0.12, 0, -0.45], [-0.12, 0, -0.45], 0, [0, 0, 0]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    geo.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
    geo.setAttribute('aOuter', new THREE.Float32BufferAttribute(outer, 1));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(p.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    const seeds = new Float32Array(BIRDS * 4).map(() => Math.random());
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    const mat = new THREE.MeshStandardMaterial({ color: '#2a2622', side: THREE.DoubleSide, roughness: 0.9 });
    this.animate(
      mat,
      'attribute float aWing;\nattribute float aOuter;\nattribute vec4 aSeed;',
      /* glsl */ `
        // Wheel around the flock center on a wide circle, flapping in bursts between long glides.
        float r = 25.0 + 30.0 * aSeed.x;
        float w = (0.12 + 0.08 * aSeed.y) * (aSeed.z > 0.5 ? 1.0 : -1.0);
        float ang = uTime * w + aSeed.w * 6.2831;
        float flapping = smoothstep(0.2, 0.6, sin(uTime * 0.4 + aSeed.x * 10.0));
        float beat = sin(uTime * 7.0 + aSeed.y * 20.0) * flapping;
        float lift = (beat * 0.55 + 0.12) * abs(aWing);
        transformed.y += abs(transformed.x) * lift + aOuter * beat * 0.25;
        transformed *= 0.9 + 0.4 * aSeed.z;
        vec3 offset = vec3(cos(ang) * r, sin(uTime * 0.3 + aSeed.y * 6.0) * 3.0 + aSeed.x * 10.0, sin(ang) * r);
        // Face along the circle, banking into the turn.
        float heading = -ang + (w > 0.0 ? 3.14159 : 0.0);
        float bank = 0.35 * sign(w);
        transformed = vec3(transformed.x * cos(bank) - transformed.y * sin(bank), transformed.x * sin(bank) + transformed.y * cos(bank), transformed.z);
        transformed = rotY(transformed, heading) + offset;
        transformed *= step(0.5, uDay);
      `,
    );
    const mesh = new THREE.InstancedMesh(geo, mat, BIRDS);
    mesh.frustumCulled = false;
    this.disposables.push(geo, mat);
    for (let f = 0; f < 2; f++) this.flocks.push({ center: new THREE.Vector3(1e6, 0, 0), until: 0 });
    return mesh;
  }

  private createLeaves() {
    const geo = new THREE.PlaneGeometry(0.13, 0.17);
    const seeds = new Float32Array(LEAVES * 4).map(() => Math.random());
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    const map = createLeafTexture();
    // A little self-light: thin leaves glow with the light coming through them even in the canopy's shade.
    const mat = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, emissive: '#3a3010' });
    this.animate(
      mat,
      'attribute vec4 aSeed;',
      /* glsl */ `
        // Tumble: spin about a tilted axis while swinging side to side on the way down.
        float t = uTime + aSeed.x * 50.0;
        float spin = t * (1.5 + 2.0 * aSeed.y);
        vec3 v = transformed;
        v = vec3(v.x, v.y * cos(spin) - v.z * sin(spin), v.y * sin(spin) + v.z * cos(spin));
        v = rotY(v, t * 0.7 + aSeed.z * 6.28);
        float fall = t * (0.45 + 0.35 * aSeed.w);
        vec3 p = vec3(aSeed.x, 0.0, aSeed.z) * ${LEAF_BOX.toFixed(1)};
        p += vec3(sin(t * 1.3 + aSeed.y * 6.0) * 0.8 + t * 0.25, -fall, cos(t * 1.1 + aSeed.w * 6.0) * 0.8 + t * 0.1);
        // Wrap into a box around the viewer: from the canopy (about 14 m up) down to the ground.
        p.xz = mod(p.xz - uCam.xz + ${(LEAF_BOX / 2).toFixed(1)}, ${LEAF_BOX.toFixed(1)}) - ${(LEAF_BOX / 2).toFixed(1)} + uCam.xz;
        p.y = uCam.y + 12.0 - mod(-p.y + aSeed.y * 16.0, 16.0);
        // Only some leaves fall where there are fewer trees.
        float show = step(aSeed.w, uLeafAmount);
        transformed = v * show + p;
      `,
    );
    const mesh = new THREE.InstancedMesh(geo, mat, LEAVES);
    const leafColors = ['#9bb042', '#c9a23a', '#7f9a35', '#d08a30', '#b8b048'].map((c) => new THREE.Color(c));
    for (let i = 0; i < LEAVES; i++) mesh.setColorAt(i, leafColors[i % leafColors.length]);
    mesh.frustumCulled = false;
    this.disposables.push(geo, mat, map);
    return mesh;
  }

  /** A spot in open, flowery meadow near (x, z), or null. */
  private meadowSpot(x: number, z: number) {
    for (let k = 0; k < 8; k++) {
      const a = this.rand() * Math.PI * 2, d = 4 + this.rand() * 30;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      const h = this.world.height(px, pz);
      // Above the knee-high grass tops, where the flowers are.
      if (h > 3 && this.world.forest(px, pz) < 0.3) return new THREE.Vector3(px, h + 1.0 + this.rand() * 0.6, pz);
    }
    return null;
  }

  update(time: number, camera: THREE.Camera, daylight: number, forestHere: number) {
    const u = this.uniforms;
    u.uTime.value = time;
    u.uDay.value = daylight;
    u.uCam.value.copy(camera.position);
    const cam = camera.position;
    const enabled = quality.motes > 0.25;

    // Butterflies: re-home any that strayed far from the viewer to a fresh meadow spot.
    const count = Math.round(BUTTERFLIES * Math.min(1, quality.motes + 0.2));
    for (let i = 0; i < count; i++) {
      const anchor = this.anchors[i];
      if (anchor.distanceToSquared(cam) < 60 * 60) continue;
      const spot = this.meadowSpot(cam.x, cam.z);
      if (!spot) continue;
      anchor.copy(spot);
      this.butterflies.setMatrixAt(i, this.matrix.makeTranslation(anchor));
      this.butterflies.instanceMatrix.needsUpdate = true;
    }
    this.butterflies.count = count;
    // None in winter or over snow.
    this.butterflies.visible = enabled && daylight > 0.5 && seasonUniforms.uWither.value < 0.5 && weatherUniforms.uSnow.value < 0.3;

    // Birds: two flocks wheel high over the land near you, drifting off and on every minute or so.
    for (let f = 0; f < this.flocks.length; f++) {
      const flock = this.flocks[f];
      if (flock.until < time || flock.center.distanceToSquared(cam) > 400 * 400) {
        const a = this.rand() * Math.PI * 2, d = 60 + this.rand() * 140;
        const x = cam.x + Math.cos(a) * d, z = cam.z + Math.sin(a) * d;
        flock.center.set(x, Math.max(this.world.height(x, z), 0) + 45 + this.rand() * 30, z);
        flock.until = time + 50 + this.rand() * 60;
      }
      for (let i = f; i < BIRDS; i += this.flocks.length) this.birds.setMatrixAt(i, this.matrix.makeTranslation(flock.center));
    }
    this.birds.instanceMatrix.needsUpdate = true;
    this.birds.visible = enabled && daylight > 0.3;

    u.uLeafAmount.value = THREE.MathUtils.smoothstep(forestHere, 0.1, 0.7) * 0.9 * quality.motes;
    this.leaves.visible = enabled && u.uLeafAmount.value > 0.01;
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.butterflies.dispose();
    this.birds.dispose();
    this.leaves.dispose();
  }
}
