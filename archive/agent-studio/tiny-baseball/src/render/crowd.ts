import * as THREE from 'three';
import { PALETTE } from './palette';

const SHIRT_COLORS = [
  PALETTE.red,
  PALETTE.blue,
  PALETTE.yellow,
  PALETTE.teal,
  PALETTE.pink,
  PALETTE.purple,
  PALETTE.cream,
];

export interface Crowd {
  count: number;
  update(t: number, dt: number): void;
  cheer(): void;
  bigCheer(): void;
  confettiBurst(): void;
}

/**
 * SPEC §5 — ≥150 instanced crowd members with idle sway, jump-on-hit,
 * traveling wave on home runs, plus a confetti burst.
 */
export function buildCrowd(scene: THREE.Scene, seats: THREE.Vector3[]): Crowd {
  const count = seats.length;
  const bodyGeo = new THREE.BoxGeometry(0.55, 0.65, 0.4);
  const headGeo = new THREE.BoxGeometry(0.45, 0.45, 0.4);
  const bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshLambertMaterial(), count);
  const heads = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial({ color: PALETTE.skin }), count);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    bodies.setColorAt(i, color.set(SHIRT_COLORS[i % SHIRT_COLORS.length]));
  }
  bodies.instanceColor!.needsUpdate = true;
  scene.add(bodies);
  scene.add(heads);

  const phases = new Float32Array(count).map(() => Math.random() * Math.PI * 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scl = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  const eul = new THREE.Euler();

  let jumpUntil = 0;
  let waveUntil = 0;
  let now = 0;

  // Confetti
  const CONFETTI = 160;
  const confetti = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.28, 0.28),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    CONFETTI,
  );
  confetti.visible = false;
  const cVel: THREE.Vector3[] = [];
  const cPos: THREE.Vector3[] = [];
  for (let i = 0; i < CONFETTI; i++) {
    confetti.setColorAt(i, color.set(SHIRT_COLORS[i % SHIRT_COLORS.length]));
    cVel.push(new THREE.Vector3());
    cPos.push(new THREE.Vector3());
  }
  confetti.instanceColor!.needsUpdate = true;
  scene.add(confetti);
  let confettiUntil = 0;

  function update(t: number, dt: number): void {
    now = t;
    const jumping = t < jumpUntil;
    const waving = t < waveUntil;
    for (let i = 0; i < count; i++) {
      const seat = seats[i];
      let y = seat.y + Math.sin(t * 2 + phases[i]) * 0.05; // idle sway
      let lean = Math.sin(t * 1.5 + phases[i]) * 0.06;
      if (jumping) y += Math.abs(Math.sin(t * 9 + phases[i])) * 0.45;
      if (waving) {
        // Wave travels along the seat index
        const w = Math.sin(t * 6 - i * 0.35);
        y += Math.max(0, w) * 0.9;
      }
      pos.set(seat.x, y + 0.33, seat.z);
      q.setFromEuler(eul.set(0, 0, lean));
      m.compose(pos, q, scl);
      bodies.setMatrixAt(i, m);
      pos.y += 0.55;
      m.compose(pos, q, scl);
      heads.setMatrixAt(i, m);
    }
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;

    if (confetti.visible) {
      if (t > confettiUntil) {
        confetti.visible = false;
      } else {
        for (let i = 0; i < CONFETTI; i++) {
          cVel[i].y -= 9.8 * dt * 0.35;
          cPos[i].addScaledVector(cVel[i], dt);
          q.setFromEuler(eul.set(t * 3 + i, t * 2 + i, 0));
          m.compose(cPos[i], q, scl);
          confetti.setMatrixAt(i, m);
        }
        confetti.instanceMatrix.needsUpdate = true;
      }
    }
  }

  return {
    count,
    update,
    cheer() {
      jumpUntil = now + 1.4;
    },
    bigCheer() {
      jumpUntil = now + 2.2;
      waveUntil = now + 3.0;
    },
    confettiBurst() {
      confetti.visible = true;
      confettiUntil = now + 3.0;
      for (let i = 0; i < CONFETTI; i++) {
        cPos[i].set((Math.random() - 0.5) * 10, 8 + Math.random() * 5, -8 - Math.random() * 8);
        cVel[i].set((Math.random() - 0.5) * 4, Math.random() * 2, (Math.random() - 0.5) * 4);
      }
    },
  };
}
