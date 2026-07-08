import * as THREE from 'three';
import { PALETTE } from './palette';
import { FIELD } from './scene';
import type { Outcome, PitchType, Lane } from '../engine/resolve';

export interface BallFx {
  mesh: THREE.Mesh;
  /** Start a pitch animation lasting flightMs. */
  throwPitch(pitch: PitchType, lane: Lane, flightMs: number): void;
  /** Animate the outcome of contact (or hide the ball). */
  resolve(outcome: Outcome): void;
  update(dt: number): void;
}

export function buildBall(scene: THREE.Scene): BallFx {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 8, 6),
    new THREE.MeshLambertMaterial({ color: PALETTE.white }),
  );
  mesh.visible = false;
  scene.add(mesh);

  type Mode = 'idle' | 'pitch' | 'hit';
  let mode: Mode = 'idle';
  let t = 0;
  let dur = 0;
  let pitchKind: PitchType = 'fastball';
  let laneX = 0;
  const from = new THREE.Vector3();
  const to = new THREE.Vector3();
  const hitVel = new THREE.Vector3();

  return {
    mesh,
    throwPitch(pitch, lane, flightMs) {
      mode = 'pitch';
      t = 0;
      dur = flightMs / 1000;
      pitchKind = pitch;
      laneX = lane * 0.9;
      from.copy(FIELD.mound).add(new THREE.Vector3(0, 0.7, 0.5));
      to.set(laneX, 0.9, 0.4);
      mesh.position.copy(from);
      mesh.visible = true;
    },
    resolve(outcome) {
      switch (outcome) {
        case 'homerun':
          mode = 'hit';
          hitVel.set((Math.random() - 0.5) * 10, 16, -26);
          break;
        case 'triple':
        case 'double':
          mode = 'hit';
          hitVel.set((Math.random() < 0.5 ? -1 : 1) * 12, 10, -18);
          break;
        case 'single':
          mode = 'hit';
          hitVel.set((Math.random() - 0.5) * 12, 5, -16);
          break;
        case 'flyout':
          mode = 'hit';
          hitVel.set((Math.random() - 0.5) * 6, 14, -12);
          break;
        case 'groundout':
          mode = 'hit';
          hitVel.set((Math.random() - 0.5) * 8, 2, -14);
          break;
        case 'foul':
          mode = 'hit';
          hitVel.set((Math.random() < 0.5 ? -1 : 1) * 14, 8, 6);
          break;
        default:
          mode = 'idle';
          mesh.visible = false;
      }
      t = 0;
    },
    update(dt) {
      if (mode === 'idle') return;
      t += dt;
      if (mode === 'pitch') {
        const k = Math.min(1, t / dur);
        mesh.position.lerpVectors(from, to, k);
        // Pitch personality: curve bends, changeup floats then drops.
        if (pitchKind === 'curve') mesh.position.x += Math.sin(k * Math.PI) * 1.1;
        if (pitchKind === 'changeup') mesh.position.y += Math.sin(k * Math.PI) * 0.8 - k * 0.3;
        mesh.position.y += Math.sin(k * Math.PI) * 0.4;
        if (k >= 1) mode = 'idle';
      } else {
        hitVel.y -= 22 * dt;
        mesh.position.addScaledVector(hitVel, dt);
        if (mesh.position.y < 0.1 || t > 2.5) {
          mode = 'idle';
          mesh.visible = false;
        }
      }
    },
  };
}
