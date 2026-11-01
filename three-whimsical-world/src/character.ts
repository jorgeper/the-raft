import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * The playable Viking: Quaternius' CC0 base character and Ranger outfit with a beard, long hair and a cloak
 * (assembled in Blender, see docs/CHARACTER.md), animated with clips from Quaternius' CC0 Universal Animation
 * Library. Both files share one skeleton, so clips bind by bone name.
 */

type ClipName = 'Idle_Loop' | 'Idle_Torch_Loop' | 'Walk_Loop' | 'Jog_Fwd_Loop' | 'Sprint_Loop' | 'Jump_Start' | 'Jump_Loop' | 'Jump_Land';

/** Ground speed (m/s) each locomotion clip covers at normal playback, measured from the library's root-motion version. */
const NATURAL_SPEED: Partial<Record<ClipName, number>> = { Walk_Loop: 0.97, Jog_Fwd_Loop: 5.36, Sprint_Loop: 8.25 };

export interface MotionState {
  /** Horizontal ground speed, m/s. */
  speed: number;
  grounded: boolean;
  /** True on the frame a jump starts. */
  jumped: boolean;
  torch: boolean;
}

export class Character {
  /** Placed at the feet; rotation.y is the facing. The model faces +Z. */
  readonly root = new THREE.Group();
  readonly handBone: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private actions = new Map<ClipName, THREE.AnimationAction>();
  private current: ClipName | null = null;
  /** Locks the current clip (jump take-off, landing) until this many seconds pass. */
  private hold = 0;
  private airTime = 0;
  private facing = 0;
  /** The gait clip's phase (0..1) at the last `footfalls()` call. */
  private lastPhase = 0;

  private constructor(model: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.root.add(model);
    model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // Skinned bounds don't follow the animation; never cull the character.
      mesh.frustumCulled = false;
      for (const m of [mesh.material].flat() as THREE.MeshStandardMaterial[]) {
        // Blender exported "hashed" blending; everything here is opaque.
        m.transparent = false;
        m.depthWrite = true;
        if (m.name === 'MI_Cloak') m.side = THREE.DoubleSide;
      }
    });
    this.handBone = model.getObjectByName('hand_r')!;
    this.mixer = new THREE.AnimationMixer(model);
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      if (!clip.name.endsWith('_Loop')) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(clip.name as ClipName, action);
    }
    this.play('Idle_Loop', 0);
  }

  /** Resolves to null when the model files are missing, so the world still runs without a character. */
  static async load(base = '/models/'): Promise<Character | null> {
    try {
      const loader = new GLTFLoader();
      const [model, anims] = await Promise.all([loader.loadAsync(base + 'viking.glb'), loader.loadAsync(base + 'viking-anims.glb')]);
      return new Character(model.scene, anims.animations);
    } catch (err) {
      console.warn('Character not loaded:', err);
      return null;
    }
  }

  private play(name: ClipName, fade = 0.25, timeScale = 1, startAt = 0) {
    const next = this.actions.get(name);
    if (!next) return;
    next.timeScale = timeScale;
    if (this.current === name) return;
    const prev = this.current ? this.actions.get(this.current) : undefined;
    next.reset();
    next.time = startAt;
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (prev && fade > 0) prev.crossFadeTo(next, fade, false);
    else prev?.stop();
    this.current = name;
  }

  /** `feet` is the ground point under the player; `moveDir` the horizontal direction of travel (any length). */
  update(dt: number, feet: THREE.Vector3, moveDir: THREE.Vector3, state: MotionState) {
    this.root.position.copy(feet);
    // Turn toward the direction of travel, taking the short way round.
    if (state.speed > 0.3 && moveDir.lengthSq() > 1e-6) {
      const target = Math.atan2(moveDir.x, moveDir.z);
      let delta = target - this.facing;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      this.facing += delta * Math.min(dt * 12, 1);
    }
    this.root.rotation.y = this.facing;

    this.hold -= dt;
    if (!state.grounded) this.airTime += dt;

    if (state.jumped) {
      // Skip the crouch at the start of the clip: our jump leaves the ground at once.
      this.play('Jump_Start', 0.08, 1.6, 0.35);
      this.hold = 0.35;
    } else if (!state.grounded) {
      if (this.hold <= 0 && this.airTime > 0.15) this.play('Jump_Loop', 0.25);
    } else if (this.airTime > 0.3) {
      // Just landed after a real fall or jump.
      this.play('Jump_Land', 0.08, 1.5, 0.1);
      this.hold = state.speed > 2 ? 0.18 : 0.4;
    }
    if (state.grounded) this.airTime = 0;

    if (state.grounded && this.hold <= 0) {
      const s = state.speed;
      let clip: ClipName = state.torch ? 'Idle_Torch_Loop' : 'Idle_Loop';
      // Hysteresis around each threshold so the gait doesn't flicker at a boundary.
      const was = this.current;
      if (s > (was === 'Sprint_Loop' ? 6.5 : 7.2)) clip = 'Sprint_Loop';
      else if (s > (was === 'Jog_Fwd_Loop' ? 2.0 : 2.6)) clip = 'Jog_Fwd_Loop';
      else if (s > 0.3) clip = 'Walk_Loop';
      const natural = NATURAL_SPEED[clip];
      const timeScale = natural ? THREE.MathUtils.clamp(s / natural, 0.6, 1.8) : 1;
      this.play(clip, 0.22, timeScale);
    }
    this.mixer.update(dt);
  }

  /**
   * How many feet have come down since the last call: two footfalls per cycle of the walk, jog or sprint clip
   * playing now (at its playback speed), so footstep sounds keep the legs' rhythm.
   */
  footfalls() {
    const clip = this.current;
    const action = clip && NATURAL_SPEED[clip] ? this.actions.get(clip) : undefined;
    if (!action) {
      this.lastPhase = 0;
      return 0;
    }
    const phase = (action.time / action.getClip().duration) % 1;
    const before = this.lastPhase;
    this.lastPhase = phase;
    // Half-cycle boundaries crossed (the clip wraps from 1 back to 0).
    const half = (p: number) => Math.floor(p * 2);
    return phase >= before ? half(phase) - half(before) : 2 - half(before) + half(phase);
  }

  /** Turns at once to face a horizontal direction (after spawning or teleporting). */
  face(dir: THREE.Vector3) {
    this.facing = Math.atan2(dir.x, dir.z);
    this.root.rotation.y = this.facing;
  }

  set visible(v: boolean) {
    this.root.visible = v;
  }
}
