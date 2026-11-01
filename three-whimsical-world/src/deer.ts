import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import type { WorldFns } from './worldgen';

/**
 * Red deer at the forest edges: small herds (a stag, a few does, sometimes a fawn) that graze, lift their heads to
 * look around, wander a few steps, stop to stare when the player approaches, and bolt into the trees when the
 * player comes close.
 *
 * The models (`public/models/deer.glb`, modeled for this project in Blender from metaballs, vertex-painted) share
 * one skeleton, rigged and animated by `scripts/blender/rig-deer.py`: Graze, Alert, Walk and Gallop loops (and an
 * Idle not used yet), without root motion. Each deer is a skinned clone with its own mixer; states crossfade between clips, and gait
 * playback follows ground speed so hooves don't slide.
 * In the model the deer faces -Z, hooves at y = 0, about 1.1 m at the shoulder.
 */

/**
 * Touch-ups to the exported model: smaller ears (they read as mouse ears from the side), a darker muzzle (the pale
 * chin read as a ball on the nose), and a slightly lighter coat.
 */
function refine(geometry: THREE.BufferGeometry) {
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const col = geometry.attributes.color as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const r = col.getX(i), g = col.getY(i), b = col.getZ(i);
    // Ears: coat-colored (reddish, unlike the beige antlers) parts beside and above the head.
    if (Math.abs(x) > 0.06 && Math.abs(x) < 0.3 && y > 1.6 && y < 1.9 && z > -0.98 && z < -0.62 && r > b * 1.45) {
      const k = 0.7, sx = Math.sign(x);
      pos.setXYZ(i, sx * 0.06 + (x - sx * 0.06) * k, 1.66 + (y - 1.66) * k, -0.81 + (z + 0.81) * k);
    }
    let c = 1.15;
    if (z < -1.0) c *= THREE.MathUtils.lerp(1, 0.55, THREE.MathUtils.smoothstep(-z, 1.0, 1.1));
    // The colors are normalized Uint16: above 1 they would wrap around to near black (blue blotches on the white rump).
    col.setXYZ(i, Math.min(r * c, 1), Math.min(g * c, 1), Math.min(b * c, 1));
  }
  geometry.computeVertexNormals();
}

type State = 'graze' | 'look' | 'walk' | 'stare' | 'flee';
type Clip = 'Idle' | 'Graze' | 'Alert' | 'Walk' | 'Gallop';

/** The clip each state plays. */
const CLIP: Record<State, Clip> = { graze: 'Graze', look: 'Alert', walk: 'Walk', stare: 'Alert', flee: 'Gallop' };
/** Ground speed each gait was keyed for (m/s, at scale 1): playback scales with the real speed. */
const NATURAL_SPEED: Partial<Record<Clip, number>> = { Walk: 1.1, Gallop: 9 };

interface Deer {
  kind: 'stag' | 'doe' | 'fawn';
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Record<Clip, THREE.AnimationAction>;
  clip: Clip;
  pos: THREE.Vector3;
  heading: number;
  target: THREE.Vector2;
  state: State;
  timer: number;
  speed: number;
  scale: number;
  /** Seconds before this deer will stop to stare again (so a lingering player doesn't pin it in place). */
  stareCooldown: number;
  /** A fawn keeps close to its mother. */
  mother?: Deer;
}

const HERDS = 4;
const SPAWN_MIN = 45, SPAWN_MAX = 140;
/** Inside this distance a deer stops and stares at the player... */
const WARY = 48;
/** ...and inside this one it bolts, running until well out of reach. */
const STARTLE = 26;

export class DeerHerds {
  readonly group = new THREE.Group();
  private deer: Deer[] = [];
  private template?: THREE.Object3D;
  private clips: THREE.AnimationClip[] = [];
  private material?: THREE.MeshStandardMaterial;
  private fawnMaterial?: THREE.MeshStandardMaterial;
  private rand = Math.random;
  private lastTime = 0;

  constructor(private world: WorldFns) {
    new GLTFLoader().load(`${import.meta.env.BASE_URL}models/deer.glb`, (gltf) => this.build(gltf.scene, gltf.animations));
  }

  private build(scene: THREE.Object3D, clips: THREE.AnimationClip[]) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
    material.onBeforeCompile = (shader) => {
      // A soft sheen on the coat's rim, like fur catching the light.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float deerRim = pow(1.0 - abs(dot(normalize(vViewPosition), normal)), 3.0);
        totalEmissiveRadiance += diffuseColor.rgb * deerRim * 0.25;`,
      );
    };
    material.customProgramCacheKey = () => 'deer';
    this.material = material;
    // Fawns wear white spots in rows along the back and upper flanks, placed in the rest pose so they move with
    // the skin.
    const fawn = material.clone();
    fawn.onBeforeCompile = (shader, renderer) => {
      material.onBeforeCompile(shader, renderer);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRest;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = position;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vRest;
          vec2 fawnHash(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            // The model faces -z: the back runs along z at the top of the barrel. Spots in loose rows, lying along it.
            float side = sign(vRest.x);
            vec2 sp = vec2(vRest.z * 11.0, (vRest.y - abs(vRest.x) * 0.6) * 15.0 + side * 0.37);
            vec2 cell = floor(sp), fc = fract(sp);
            float d = 9.0;
            for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
              vec2 o = vec2(i, j);
              vec2 h = fawnHash(cell + o + side * 7.0);
              d = min(d, length((o + 0.25 + h * 0.5 - fc) * vec2(0.85, 1.2)));
            }
            float region = smoothstep(0.86, 0.94, vRest.y) * smoothstep(-0.45, -0.3, vRest.z) * (1.0 - smoothstep(0.55, 0.68, vRest.z))
              * (1.0 - smoothstep(1.2, 1.26, vRest.y));
            // Only on the reddish coat, not the pale belly or dark nose.
            float coat = smoothstep(1.2, 1.6, vColor.r / max(vColor.b, 1e-3));
            float spot = (1.0 - smoothstep(0.17, 0.24, d)) * region * coat;
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.78, 0.7, 0.58), spot * 0.85);
          }`,
        );
    };
    fawn.customProgramCacheKey = () => 'deer-fawn';
    this.fawnMaterial = fawn;
    scene.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      refine(mesh.geometry);
      mesh.material = material;
      mesh.castShadow = mesh.receiveShadow = true;
      // The bind-pose bounds miss a lowered head or a stretched gallop; the herd is small, so skip culling.
      mesh.frustumCulled = false;
    });
    this.template = scene;
    this.clips = clips;
  }

  /** A skinned copy of the rig showing only the doe or the stag body. */
  private spawnModel(kind: Deer['kind']) {
    const root = cloneSkinned(this.template!);
    const keep = kind === 'stag' ? 'Stag' : 'Doe';
    for (const name of ['Doe', 'Stag']) if (name !== keep) root.getObjectByName(name)?.removeFromParent();
    if (kind === 'fawn') root.traverse((o) => ((o as THREE.SkinnedMesh).isSkinnedMesh ? ((o as THREE.SkinnedMesh).material = this.fawnMaterial!) : 0));
    const mixer = new THREE.AnimationMixer(root);
    const actions = {} as Record<Clip, THREE.AnimationAction>;
    for (const clip of this.clips) actions[clip.name as Clip] = mixer.clipAction(clip);
    this.group.add(root);
    return { root, mixer, actions };
  }

  /** A spot at the forest edge, on gentle dry ground, in a ring around the viewer. */
  private findSpot(center: THREE.Vector3, out: THREE.Vector3, minR = SPAWN_MIN, maxR = SPAWN_MAX) {
    const w = this.world;
    for (let i = 0; i < 120; i++) {
      const a = this.rand() * Math.PI * 2, r = minR + this.rand() * (maxR - minR);
      const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
      const f = w.forest(x, z), h = w.height(x, z);
      if (h < 2.5 || f < 0.04 || f > 0.6 || w.river(x, z) > 0.2 || w.pondEdge(x, z) < 4) continue;
      const slope = Math.abs(w.height(x + 2, z) - w.height(x - 2, z)) + Math.abs(w.height(x, z + 2) - w.height(x, z - 2));
      if (slope > 1.6) continue;
      return out.set(x, h, z);
    }
    return null;
  }

  private spawnHerd(center: THREE.Vector3) {
    const spot = this.findSpot(center, new THREE.Vector3());
    if (!spot) return;
    const does = 1 + Math.floor(this.rand() * 3);
    const withStag = this.rand() < 0.6;
    const withFawn = this.rand() < 0.45;
    const kinds: Deer['kind'][] = [...(withStag ? ['stag' as const] : []), ...Array<'doe'>(does).fill('doe'), ...(withFawn ? ['fawn' as const] : [])];
    let mother: Deer | undefined;
    for (const kind of kinds) {
      const pos = spot.clone().add(new THREE.Vector3((this.rand() - 0.5) * 8, 0, (this.rand() - 0.5) * 8));
      if (kind === 'fawn' && mother) pos.copy(mother.pos).add(new THREE.Vector3(1.2, 0, 0.8));
      pos.y = this.world.height(pos.x, pos.z);
      const model = this.spawnModel(kind);
      const d: Deer = {
        kind,
        ...model,
        clip: 'Graze',
        pos,
        heading: this.rand() * Math.PI * 2,
        target: new THREE.Vector2(pos.x, pos.z),
        state: 'graze',
        timer: 2 + this.rand() * 6,
        speed: 0,
        scale: kind === 'stag' ? 1.12 + this.rand() * 0.08 : kind === 'fawn' ? 0.55 + this.rand() * 0.06 : 0.92 + this.rand() * 0.1,
        stareCooldown: 0,
        mother: kind === 'fawn' ? mother : undefined,
      };
      if (kind === 'doe' && !mother) mother = d;
      // Start mid-clip, so a herd doesn't move in lockstep.
      const first = d.actions.Graze;
      first.play();
      first.time = this.rand() * first.getClip().duration;
      this.deer.push(d);
    }
  }

  update(time: number, viewer: THREE.Vector3) {
    const dt = Math.min(time - this.lastTime, 0.1);
    this.lastTime = time;
    if (!this.template) return;
    // Herds out of sight and mind are dropped; new ones appear beyond view range.
    for (const d of this.deer) if (d.pos.distanceTo(viewer) >= 260) this.remove(d);
    this.deer = this.deer.filter((d) => d.root.parent);
    const herdsNow = Math.ceil(this.deer.length / 3);
    if (herdsNow < HERDS && this.rand() < 0.02) this.spawnHerd(viewer);
    if (this.deer.length === 0) for (let i = 0; i < HERDS; i++) this.spawnHerd(viewer);

    for (const d of this.deer) {
      this.think(d, dt, viewer);
      this.animate(d, dt);
    }
  }

  private remove(d: Deer) {
    d.mixer.stopAllAction();
    d.mixer.uncacheRoot(d.root);
    d.root.removeFromParent();
  }

  private think(d: Deer, dt: number, viewer: THREE.Vector3) {
    const dist = Math.hypot(d.pos.x - viewer.x, d.pos.z - viewer.z);
    const toViewer = Math.atan2(viewer.z - d.pos.z, viewer.x - d.pos.x);
    d.stareCooldown = Math.max(d.stareCooldown - dt, 0);
    if (dist < STARTLE && d.state !== 'flee') {
      d.state = 'flee';
      // Away from the player, toward the denser forest if there's a choice.
      const away = toViewer + Math.PI;
      let best = away, bestForest = -1;
      for (const off of [-0.6, 0, 0.6]) {
        const a = away + off, x = d.pos.x + Math.cos(a) * 30, z = d.pos.z + Math.sin(a) * 30;
        const f = this.world.forest(x, z);
        if (f > bestForest) (bestForest = f), (best = a);
      }
      d.target.set(d.pos.x + Math.cos(best) * 90, d.pos.z + Math.sin(best) * 90);
      d.timer = 12;
    } else if (dist < WARY && d.state !== 'flee' && d.state !== 'stare' && d.stareCooldown <= 0) {
      // Heads up, turn to face the intruder and hold still for a moment.
      d.state = 'stare';
      d.timer = 2.5 + this.rand() * 3;
    }
    d.timer -= dt;
    let speed = 0;
    let face: number | null = null;
    switch (d.state) {
      case 'graze':
        if (d.timer < 0) {
          d.state = this.rand() < 0.55 ? 'look' : 'walk';
          d.timer = 2 + this.rand() * 4;
          if (d.state === 'walk') {
            const a = this.rand() * Math.PI * 2;
            // A fawn wanders back to its mother's side; the rest a few steps anywhere.
            const nearMother = d.mother?.root.parent ? d.mother : undefined;
            const from = nearMother ? nearMother.pos : d.pos, r = nearMother ? 1.5 + this.rand() * 2 : 3 + this.rand() * 8;
            d.target.set(from.x + Math.cos(a) * r, from.z + Math.sin(a) * r);
          }
        }
        break;
      case 'look':
        if (d.timer < 0) (d.state = 'graze'), (d.timer = 4 + this.rand() * 8);
        break;
      case 'stare':
        face = toViewer;
        if (d.timer < 0) {
          // Satisfied (for now): back to grazing, and no more staring for a while.
          d.state = 'graze';
          d.timer = 3 + this.rand() * 5;
          d.stareCooldown = 10 + this.rand() * 10;
        }
        break;
      case 'walk':
        speed = 1.1;
        if (d.timer < 0 || Math.hypot(d.target.x - d.pos.x, d.target.y - d.pos.z) < 0.5) (d.state = 'graze'), (d.timer = 4 + this.rand() * 8);
        break;
      case 'flee':
        // A fawn runs with its mother, a little slower.
        speed = d.kind === 'fawn' ? 8 : 9;
        if (d.kind === 'fawn' && d.mother?.state === 'flee') d.target.set(d.mother.pos.x, d.mother.pos.z);
        if (d.timer < 0 || Math.hypot(d.target.x - d.pos.x, d.target.y - d.pos.z) < 2) {
          d.state = 'look';
          d.timer = 3;
          d.stareCooldown = 8;
        }
        break;
    }
    // Ease into and out of a run rather than snapping between speeds.
    d.speed += (speed - d.speed) * (1 - Math.exp(-dt * (speed > d.speed ? 2.5 : 4)));
    if (d.speed > 0.05) face = Math.atan2(d.target.y - d.pos.z, d.target.x - d.pos.x);
    if (face !== null) {
      const diff = Math.atan2(Math.sin(face - d.heading), Math.cos(face - d.heading));
      d.heading += THREE.MathUtils.clamp(diff, -dt * 3, dt * 3);
    }
    if (d.speed > 0.05) {
      const nx = d.pos.x + Math.cos(d.heading) * d.speed * dt, nz = d.pos.z + Math.sin(d.heading) * d.speed * dt;
      // Deer stay out of the water.
      if (this.world.height(nx, nz) > 1 && this.world.pondEdge(nx, nz) > 0.5) (d.pos.x = nx), (d.pos.z = nz);
      else d.target.set(d.pos.x - (nx - d.pos.x) * 40, d.pos.z - (nz - d.pos.z) * 40);
      d.pos.y = this.world.height(d.pos.x, d.pos.z);
    }
  }

  private animate(d: Deer, dt: number) {
    // While still easing to a stop after a walk or run, keep the gait going (slowed) instead of sliding.
    let want: Clip = CLIP[d.state];
    if (d.speed > 0.35 && !NATURAL_SPEED[want]) want = d.speed > 3 ? 'Gallop' : 'Walk';
    else if (d.speed > 3) want = 'Gallop';
    if (want !== d.clip) {
      const next = d.actions[want];
      next.reset().play();
      d.actions[d.clip].crossFadeTo(next, want === 'Gallop' || d.clip === 'Gallop' ? 0.25 : 0.5, false);
      d.clip = want;
    }
    const natural = NATURAL_SPEED[d.clip];
    // Gaits play at the rate that matches the ground speed (smaller deer take quicker steps).
    d.actions[d.clip].timeScale = natural ? THREE.MathUtils.clamp(d.speed / (natural * d.scale), 0.3, 1.6) : 1;
    d.mixer.update(dt);

    // The model faces -Z; heading 0 is +X. Sink the hooves a touch so they don't float over grassy slopes.
    d.root.position.set(d.pos.x, d.pos.y - 0.04, d.pos.z);
    d.root.rotation.set(0, -d.heading - Math.PI / 2, 0);
    d.root.scale.setScalar(d.scale);
  }

  dispose() {
    for (const d of this.deer) this.remove(d);
    this.deer = [];
    this.template?.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.material?.dispose();
    this.fawnMaterial?.dispose();
  }
}
