import * as THREE from 'three';
import type { WorldFns, Waterfall } from './worldgen';
import { addRipple } from './water';
import { RAINBOW } from './weather';

/**
 * Waterfalls: each stream (worldgen) pours over the rim of a river gorge into the alcove it has cut. The water is a
 * ribbon that leaves the lip in a parabola (sliding down the face where the rock juts out), as wide as the stream:
 * glassy green where it curls over the lip, breaking up as it falls into ropes and strands of white water with
 * gaps between, a fainter veil of spray around it. Mist billows from the plunge, foam spreads on the pool (the water
 * shader's `setPlunges`) and rings run out across it.
 *
 * Drawn in the main scene, blended over what's behind it. The blend leaves the target's alpha alone: that channel
 * carries wind motion to the TAA (see wind.ts), and a translucent sheet would read as motion.
 */

const G = 9.8;
/** Water level in the gorges (the rivers are filled by the sea plane). */
const WATER_Y = 0;

const keepAlpha = {
  blending: THREE.CustomBlending,
  blendSrc: THREE.SrcAlphaFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.ZeroFactor,
  blendDstAlpha: THREE.OneFactor,
} as const;

/** How fast the stream leaves the lip (m/s). */
const V0 = 2.8;
/** The sheet starts this far back from the lip, on the stream's surface. */
const BACK = 2.5;

/** The fall's centerline: a parabola off the lip, clinging to the face where the ground is higher. */
function fallPath(w: Waterfall, height: WorldFns['height']) {
  // From a few meters back on the stream (where its water surface stops short of the lip), along its surface.
  const pts: THREE.Vector3[] = [new THREE.Vector3(w.x - w.dirX * BACK, w.top + 0.03, w.z - w.dirZ * BACK)];
  const v0 = V0;
  let y = w.top + 0.02;
  let vy = 0;
  let s = 0;
  const dt = 0.04;
  for (let i = 0; i < 400 && y > WATER_Y - 0.3; i++) {
    const x = w.x + w.dirX * s, z = w.z + w.dirZ * s;
    const ground = height(x, z) + 0.35;
    if (y < ground) {
      // Sliding down the rock: follow the surface, losing speed to it.
      y = ground;
      vy = Math.min(vy, 0) * 0.6;
    }
    if (i % 3 === 0) pts.push(new THREE.Vector3(x, y, z));
    vy -= G * dt;
    y += vy * dt;
    s += v0 * dt;
  }
  pts.push(new THREE.Vector3(w.x + w.dirX * s, WATER_Y - 0.3, w.z + w.dirZ * s));
  return pts;
}

/** The sheet: `width` at the lip, spreading as it falls; `out` pushes it off the centerline (for the veil). */
function fallGeometry(w: Waterfall, pts: THREE.Vector3[], width0: number, spread: number, out0 = 0) {
  const COLS = 11;
  const side = new THREE.Vector3(-w.dirZ, 0, w.dirX);
  const out = new THREE.Vector3(w.dirX, 0, w.dirZ);
  const positions: number[] = [], fall: number[] = [], index: number[] = [];
  let along = 0;
  const total = pts.reduce((sum, p, i) => sum + (i ? p.distanceTo(pts[i - 1]) : 0), 0);
  pts.forEach((p, i) => {
    if (i) along += p.distanceTo(pts[i - 1]);
    const t = along / total;
    // The sheet spreads as it falls.
    const width = width0 * (1 + spread * Math.sqrt(t));
    for (let c = 0; c < COLS; c++) {
      const u = c / (COLS - 1);
      // A rounded front: the middle of the sheet stands a little proud of its edges, more as it falls.
      const bulge = Math.sin(Math.PI * u) * (0.2 + 0.8 * t) + out0 * t;
      const q = p.clone().addScaledVector(side, (u - 0.5) * width).addScaledVector(out, bulge);
      positions.push(q.x, q.y, q.z);
      fall.push(u, along, t);
    }
  });
  for (let r = 0; r < pts.length - 1; r++) {
    for (let c = 0; c < COLS - 1; c++) {
      const a = r * COLS + c, b = a + COLS;
      index.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aFall', new THREE.Float32BufferAttribute(fall, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

const sheetUniforms = { uTime: { value: 0 } };

/**
 * The falling water. Its texture moves with the water: each point on the sheet is looked up by how long the water
 * took to fall there (so the pattern scrolls at the water's own speed, stretching as it accelerates), never by a
 * fixed scroll speed, which sheared the pattern further every second the app ran. `VEIL` is the faint spray around
 * the sheet.
 */
function sheetMaterial(veil: boolean) {
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.6,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    ...keepAlpha,
  });
  if (veil) m.defines = { VEIL: 1 };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sheetUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aFall;\nvarying vec3 vFall;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFall = aFall;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uTime;
        varying vec3 vFall;
        float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float wNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y);
        }
        float glassy;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // (along: meters from the lip, negative on the stream behind it.)
          float u = vFall.x, along = vFall.y - ${BACK.toFixed(1)}, t = vFall.z;
          // Travel time from the lip (s): along ≈ v0 τ + g τ² / 2.
          float tau = (sqrt(${V0.toFixed(2)} * ${V0.toFixed(2)} + 2.0 * 9.8 * max(along, 0.0)) - ${V0.toFixed(2)}) / 9.8;
          float ph = tau - uTime;
          #ifdef VEIL
            ph *= 0.8;
            u = u * 1.7 + 3.0;
          #endif
          // Ropes: columns of water side by side, some thick and some thin, each wandering a little as it falls.
          float wander = (wNoise(vec2(u * 3.0, tau * 1.5)) - 0.5) * 0.08 * t;
          float uu = u + wander;
          float rope = wNoise(vec2(uu * 11.0, 0.5)) * 0.6 + wNoise(vec2(uu * 23.0, 3.5)) * 0.4;
          // Streaks along the fall, at the water's pace; finer ones inside them.
          float streak = wNoise(vec2(uu * 34.0, ph * 5.0)) * 0.55 + wNoise(vec2(uu * 80.0 + 7.0, ph * 11.0)) * 0.45;
          // Slugs of white water tumbling down the ropes.
          float slugs = wNoise(vec2(uu * 7.0 + 11.0, ph * 3.2)) * 0.6 + wNoise(vec2(uu * 15.0, ph * 6.5)) * 0.4;
          // Over the lip the water is one smooth, glassy sheet; within a few meters it tears into ropes and spray.
          glassy = 1.0 - smoothstep(0.2, 3.0, along);
          float torn = smoothstep(0.6, 7.0, along);
          float body = rope * 0.75 + streak * 0.5 + slugs * 0.45 - 0.8 * torn - 0.1;
          float dense = mix(1.0, smoothstep(0.02, 0.22, body), torn);
          // Ragged sides: the sheet frays most at its edges, and more the further it falls.
          float fray = 0.08 + 0.2 * t + 0.1 * slugs;
          float edge = smoothstep(0.0, fray, u) * smoothstep(1.0, 1.0 - fray, u);
          #ifdef VEIL
            dense = smoothstep(0.35, 0.75, streak * 0.5 + slugs * 0.6) * smoothstep(1.0, 8.0, along);
            edge = smoothstep(0.0, 0.3, vFall.x) * smoothstep(1.0, 0.7, vFall.x);
          #endif
          // Air beaten into it turns the water white; glassy water is a clear bottle green with the stream's bed
          // colors in it.
          float white = clamp(torn * (0.55 + 0.5 * slugs) + smoothstep(0.85, 1.0, t) * 0.5, 0.0, 1.0);
          vec3 glass = vec3(0.07, 0.16, 0.13);
          // Shaded where it's thick: the inside of a rope is in its own shadow.
          diffuseColor.rgb = mix(glass, vec3(0.82, 0.86, 0.88) * (0.75 + 0.25 * streak), white);
          // Even the glassy tongue shows the flow in faint lines.
          float alpha = mix(0.7 + 0.2 * streak, 0.08 + 0.85 * dense, torn) * edge;
          #ifdef VEIL
            diffuseColor.rgb = vec3(0.9, 0.93, 0.96);
            alpha = dense * edge * 0.22;
          #endif
          // Into the spray at the foot; and fading in on the stream behind the lip, under the stream's own surface.
          alpha *= (1.0 - smoothstep(0.92, 1.0, t) * 0.7) * smoothstep(-${BACK.toFixed(1)}, -0.8, along);
          diffuseColor.a = alpha;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        // Glassy water mirrors the sky; white water is matte.
        roughnessFactor = mix(roughnessFactor, 0.08, glassy);`,
      );
  };
  m.customProgramCacheKey = () => (veil ? 'waterfall-veil' : 'waterfall-sheet');
  return m;
}

const mistUniforms = { uTime: { value: 0 }, uLight: { value: 1 } };

/** Puffs of spray rising and spreading from the plunge, each on its own loop. */
function mistPoints(base: THREE.Vector3, rand: () => number) {
  const N = 480;
  const seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) seed.set([rand(), rand(), rand(), rand()], i * 4);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 4));
  g.boundingSphere = new THREE.Sphere(base.clone(), 30);
  const m = new THREE.ShaderMaterial({
    uniforms: { ...mistUniforms, uBase: { value: base } },
    transparent: true,
    depthWrite: false,
    ...keepAlpha,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uBase;
      attribute vec4 aSeed;
      varying float vFade;
      void main() {
        float life = fract(uTime / (2.5 + aSeed.w * 3.0) + aSeed.z);
        float a = aSeed.x * 6.2831853;
        // Billowing out from the plunge, fast at first, then drifting up and away (the gorge's draft).
        float r = (0.5 + aSeed.y * 8.0) * (1.0 - exp(-life * 3.0)) * 1.4;
        vec3 p = uBase + vec3(cos(a) * r, 0.3 + life * life * (4.0 + aSeed.y * 10.0), sin(a) * r);
        vFade = sin(3.14159 * sqrt(life)) * (0.6 + 0.4 * aSeed.y);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (3.0 + 9.0 * life) * 300.0 / max(-mv.z, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uLight;
      varying float vFade;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d);
        gl_FragColor = vec4(vec3(0.85, 0.9, 0.95) * uLight, a * a * vFade * 0.11);
      }
    `,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

/** The spray's rainbow can be held off (the demo's cliff shot stands in the spray, and is about the rock). */
export const sprayBowControl = { on: true };

const bowUniforms = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uBow: { value: 0 },
  /** The scene's depth: the bow draws after the haze (so it isn't fogged out) and stops each ray at the scene. */
  tDepth: { value: null as THREE.Texture | null },
};

/**
 * The rainbow in a fall's spray. The spray is a soft ellipsoid round the plunge, drawn out downstream (+x, where
 * the rivers run) where the drift carries it. Each pixel takes how much spray its view ray passes through and,
 * from the angle off the point opposite the sun, the bow's color there: so, as in life, the bow shows only with
 * the sun at your back, on spray 42° from your shadow, and stands up around you when you're in the spray.
 * Drawn on the ellipsoid's inside faces, so it works from within, in the overlay after the haze; each ray stops at
 * the scene's depth, so the cliffs hide what's behind them. Added to the frame, leaving alpha alone.
 */
function sprayBow(base: THREE.Vector3) {
  const center = base.clone().add(new THREE.Vector3(7, 4, 0));
  const radii = new THREE.Vector3(18, 9, 13);
  const m = new THREE.ShaderMaterial({
    uniforms: { ...bowUniforms, uCenter: { value: center }, uRadii: { value: radii } },
    transparent: true,
    depthWrite: false,
    depthTest: false,
    side: THREE.BackSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      varying vec3 vView;
      // The projection's depth terms, to turn the depth buffer back into distance.
      varying vec2 vProj;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        vec4 v = viewMatrix * w;
        vView = v.xyz;
        vProj = vec2(projectionMatrix[2][2], projectionMatrix[3][2]);
        gl_Position = projectionMatrix * v;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir, uCenter, uRadii;
      uniform float uBow;
      uniform sampler2D tDepth;
      varying vec3 vWorld;
      varying vec3 vView;
      varying vec2 vProj;
      ${RAINBOW}
      void main() {
        vec3 d = normalize(vWorld - cameraPosition);
        // How far the ray runs before it meets the scene.
        float z = texelFetch(tDepth, ivec2(gl_FragCoord.xy), 0).x * 2.0 - 1.0;
        float sceneZ = vProj.y / (z + vProj.x);
        float reach = sceneZ * length(vView) / max(-vView.z, 1e-4);
        // Spray along the ray, in the ellipsoid's own unit space: march from where the ray enters the cloud to
        // where it leaves it (or meets the scene) and add up the mist, so a ray grazing the edge or stopped by a
        // nearby rock gets little, and one crossing the plunge's heart gets the most.
        vec3 o = (cameraPosition - uCenter) / uRadii;
        vec3 dr = d / uRadii;
        float a = dot(dr, dr), b = dot(o, dr), c = dot(o, o) - 2.56;
        float h = b * b - a * c;
        if (h <= 0.0) discard;
        h = sqrt(h);
        float t0 = max((-b - h) / a, 0.0);
        float t1 = min((-b + h) / a, reach);
        if (t1 <= t0) discard;
        float dt = (t1 - t0) / 10.0;
        float depth = 0.0;
        for (int i = 0; i < 10; i++) {
          vec3 p = o + dr * (t0 + (float(i) + 0.5) * dt);
          depth += exp(-dot(p, p) * 3.0);
        }
        depth *= dt * sqrt(a);
        float spray = 1.0 - exp(-1.4 * depth);
        vec3 bow = rainbow(d, uSunDir);
        gl_FragColor = vec4(bow * spray * uBow * 1.3, 0.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), m);
  mesh.position.copy(center);
  mesh.scale.copy(radii).multiplyScalar(1.6);
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  return mesh;
}

export class Waterfalls {
  readonly group = new THREE.Group();
  /** The spray rainbows, for the overlay scene (drawn after the haze); see `setSceneDepth`. */
  readonly overlay = new THREE.Group();
  private bases: THREE.Vector3[] = [];
  /** Where each fall hits the water (x, z, radius of its foam, strength), for the water shader. */
  readonly plunges: THREE.Vector4[] = [];
  private nextRipple = 0;
  private rand: () => number;

  constructor(private world: WorldFns) {
    let s = world.params.seed * 31 + 7;
    this.rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const sheet = sheetMaterial(false), veil = sheetMaterial(true);
    for (const w of world.waterfalls) {
      const pts = fallPath(w, world.height);
      const lipWidth = 2 * w.stream[w.stream.length - 1].w;
      const mesh = new THREE.Mesh(fallGeometry(w, pts, lipWidth, 0.7), sheet);
      mesh.renderOrder = 2;
      const spray = new THREE.Mesh(fallGeometry(w, pts, lipWidth * 1.3, 1.4, 0.8), veil);
      spray.renderOrder = 3;
      this.group.add(mesh, spray);
      const base = pts[pts.length - 1].clone().setY(WATER_Y);
      this.bases.push(base);
      this.plunges.push(new THREE.Vector4(base.x, base.z, lipWidth * 1.2, 1));
      this.group.add(mistPoints(base, this.rand));
      this.overlay.add(sprayBow(base));
    }
  }

  setSceneDepth(depth: THREE.Texture) {
    bowUniforms.tDepth.value = depth;
  }

  /** `light`: how bright the day is (0 at night), for the mist; `sunDir` (toward the sun) and `sunny` (0 under
   * cloud) for the rainbow in the spray. */
  update(time: number, camera: THREE.Vector3, light: number, sunDir: THREE.Vector3, sunny: number) {
    bowUniforms.uSunDir.value.copy(sunDir);
    // A bow needs direct sun: none at night, nor once the sun is down.
    bowUniforms.uBow.value = sprayBowControl.on ? light * sunny * THREE.MathUtils.smoothstep(sunDir.y, -0.02, 0.05) : 0;
    sheetUniforms.uTime.value = time;
    mistUniforms.uTime.value = time;
    mistUniforms.uLight.value = 0.15 + 1.6 * light;
    // Rings spreading from the plunge, while someone is near enough to see them.
    if (time > this.nextRipple) {
      this.nextRipple = time + 0.35;
      for (const b of this.bases) {
        if (b.distanceTo(camera) > 260) continue;
        const a = this.rand() * Math.PI * 2, r = 0.5 + this.rand() * 2.5;
        addRipple(b.x + Math.cos(a) * r, b.z + Math.sin(a) * r, time, 0.6 + this.rand() * 0.5);
      }
    }
  }

  dispose() {
    for (const g of [this.group, this.overlay]) {
      g.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
    }
    this.overlay.removeFromParent();
  }
}
