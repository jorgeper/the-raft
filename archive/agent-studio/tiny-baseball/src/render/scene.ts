import * as THREE from 'three';
import { PALETTE } from './palette';

/** Field layout constants shared by players/ball/crowd. Home plate at origin,
 * outfield along -z, camera behind home plate. */
export const FIELD = {
  mound: new THREE.Vector3(0, 0.45, -13),
  plate: new THREE.Vector3(0, 0.6, 0),
  bases: [
    new THREE.Vector3(9, 0.25, -9), // 1st
    new THREE.Vector3(0, 0.25, -18), // 2nd
    new THREE.Vector3(-9, 0.25, -9), // 3rd
  ],
  wallRadius: 40,
};

function lambert(color: string): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

function skyTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, PALETTE.skyTop);
  grad.addColorStop(1, PALETTE.skyBottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 2, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function makeCloud(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: PALETTE.white });
  const chunks = 2 + Math.floor(Math.random() * 3);
  for (let i = 0; i < chunks; i++) {
    const w = 3 + Math.random() * 4;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, 1.6, 2.2), mat);
    box.position.set(i * 2.4 - chunks, Math.random() * 0.8, Math.random() * 1.5);
    g.add(box);
  }
  return g;
}

export interface World {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  clouds: THREE.Group[];
  baseMarkers: THREE.Mesh[];
}

export function buildWorld(): World {
  const scene = new THREE.Scene();
  scene.background = skyTexture();

  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 300);
  camera.position.set(0, 12.5, 21);
  camera.lookAt(0, 2.8, -14);

  const sunLight = new THREE.DirectionalLight(PALETTE.white, 1.35);
  sunLight.position.set(-25, 40, 20);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(PALETTE.skyBottom, 0.85));

  // Grass
  const grass = new THREE.Mesh(new THREE.CircleGeometry(70, 40), lambert(PALETTE.grass));
  grass.rotation.x = -Math.PI / 2;
  grass.position.z = -10;
  scene.add(grass);

  // Mowing stripes (darker green rings)
  for (let r = 8; r < 38; r += 8) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 4, 48), lambert(PALETTE.grassDark));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    scene.add(ring);
  }

  // Dirt infield diamond (rotated square) + mound + home circle
  const dirt = new THREE.Mesh(new THREE.PlaneGeometry(15, 15), lambert(PALETTE.dirt));
  dirt.rotation.x = -Math.PI / 2;
  dirt.rotation.z = Math.PI / 4;
  dirt.position.set(0, 0.02, -9);
  scene.add(dirt);
  const mound = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 0.5, 10), lambert(PALETTE.dirtDark));
  mound.position.set(FIELD.mound.x, 0.25, FIELD.mound.z);
  scene.add(mound);
  const homeDirt = new THREE.Mesh(new THREE.CircleGeometry(3, 16), lambert(PALETTE.dirt));
  homeDirt.rotation.x = -Math.PI / 2;
  homeDirt.position.set(0, 0.03, 0);
  scene.add(homeDirt);

  // Foul lines
  const lineMat = lambert(PALETTE.white);
  for (const dir of [1, -1]) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 42), lineMat);
    line.position.set((dir * 42) / (2 * Math.SQRT2), 0.04, -42 / (2 * Math.SQRT2));
    line.rotation.y = (dir * Math.PI) / 4;
    scene.add(line);
  }

  // Bases + home plate
  const baseMarkers: THREE.Mesh[] = [];
  for (const b of FIELD.bases) {
    const base = new THREE.Mesh(new THREE.BoxGeometry(1, 0.2, 1), lineMat);
    base.position.copy(b);
    base.rotation.y = Math.PI / 4;
    scene.add(base);
    baseMarkers.push(base);
  }
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1, 0.12, 1), lineMat);
  plate.position.set(0, 0.06, 0);
  scene.add(plate);

  // Outfield wall — arc of green panels with a yellow top rail
  const wallMat = lambert(PALETTE.wallGreen);
  const railMat = lambert(PALETTE.yellow);
  for (let i = 0; i <= 20; i++) {
    const a = Math.PI * 1.25 - (i / 20) * Math.PI * 0.5 + Math.PI / 2; // sweep behind outfield
    const x = Math.cos(a) * FIELD.wallRadius;
    const z = Math.sin(a) * FIELD.wallRadius - 10;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(6.6, 4, 0.5), wallMat);
    panel.position.set(x, 2, z);
    panel.lookAt(0, 2, -10);
    scene.add(panel);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.35, 0.55), railMat);
    rail.position.set(x, 4.1, z);
    rail.lookAt(0, 4.1, -10);
    scene.add(rail);
  }

  // Sun — a cheery blocky sun in the sky
  const sun = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 0.4), new THREE.MeshBasicMaterial({ color: PALETTE.sun }));
  sun.position.set(-27, 21, -75);
  sun.lookAt(camera.position);
  scene.add(sun);
  for (let i = 0; i < 4; i++) {
    const ray = new THREE.Mesh(new THREE.BoxGeometry(8.6, 1, 0.3), new THREE.MeshBasicMaterial({ color: PALETTE.sun }));
    ray.position.copy(sun.position);
    ray.rotation.z = (i * Math.PI) / 4;
    ray.lookAt(camera.position);
    ray.rotateZ((i * Math.PI) / 4);
    scene.add(ray);
  }

  // Drifting blocky clouds (SPEC §4.4: at least 5)
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 7; i++) {
    const cloud = makeCloud();
    cloud.position.set(-60 + i * 20, 14 + Math.random() * 10, -45 - Math.random() * 20);
    scene.add(cloud);
    clouds.push(cloud);
  }

  return { scene, camera, clouds, baseMarkers };
}

/** Grandstand steps geometry; returns seat anchor positions for the crowd. */
export function buildStands(scene: THREE.Scene): THREE.Vector3[] {
  const seats: THREE.Vector3[] = [];
  const standMat = lambert(PALETTE.stand);
  const stepMat = lambert(PALETTE.standDark);

  // Two stands flanking the foul lines.
  for (const side of [-1, 1]) {
    const stand = new THREE.Group();
    const rows = 6;
    for (let r = 0; r < rows; r++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(30, 1.4, 2.6), r % 2 ? standMat : stepMat);
      step.position.set(0, 0.7 + r * 1.35, -r * 2.4);
      stand.add(step);
      const perRow = 15;
      for (let c = 0; c < perRow; c++) {
        seats.push(new THREE.Vector3(-13.5 + c * (27 / (perRow - 1)), 1.4 + r * 1.35, -r * 2.4));
      }
    }
    // Back wall
    const back = new THREE.Mesh(new THREE.BoxGeometry(30, 9.5, 0.6), standMat);
    back.position.set(0, 4.7, -rows * 2.4 + 0.8);
    stand.add(back);

    // Flank the foul lines: long axis parallel to the line, front row facing
    // fair territory from the foul side.
    stand.position.set(side * 24, 0, -10);
    stand.rotation.y = -side * (3 * Math.PI) / 4;
    scene.add(stand);

    // Transform seat anchors into world space for this stand.
    const start = seats.length - rows * 15;
    for (let i = start; i < seats.length; i++) {
      seats[i].applyMatrix4(new THREE.Matrix4().compose(stand.position, stand.quaternion, stand.scale));
    }
  }
  return seats;
}
