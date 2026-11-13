import * as THREE from 'three';
import { PALETTE } from './palette';
import { FIELD } from './scene';

/** Chibi ballplayer: blocky, big-headed (head is ~42% of total height,
 * SPEC §4.3). */
export function buildPlayer(shirt: string, cap: string, withBat = false): THREE.Group {
  const g = new THREE.Group();
  const mat = (c: string) => new THREE.MeshLambertMaterial({ color: c });

  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.3, 0.24), mat(PALETTE.cream));
  legs.position.y = 0.15;
  g.add(legs);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.34), mat(shirt));
  body.position.y = 0.52;
  g.add(body);

  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.14), mat(shirt));
  armL.position.set(-0.36, 0.55, 0);
  g.add(armL);
  const armR = armL.clone();
  armR.position.x = 0.36;
  g.add(armR);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.58, 0.56), mat(PALETTE.skin));
  head.position.y = 1.05;
  g.add(head);

  // Eyes — two dark pixels
  for (const dx of [-0.14, 0.14]) {
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.02), mat(PALETTE.dark));
    eye.position.set(dx, 1.07, 0.29);
    g.add(eye);
  }

  const capTop = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.16, 0.6), mat(cap));
  capTop.position.y = 1.4;
  g.add(capTop);
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.28), mat(cap));
  brim.position.set(0, 1.33, 0.4);
  g.add(brim);

  if (withBat) {
    const bat = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 0.12), mat(PALETTE.wood));
    bat.position.set(0.48, 0.95, 0.05);
    bat.rotation.z = -0.5;
    bat.name = 'bat';
    g.add(bat);
  }
  return g;
}

export interface Cast {
  batter: THREE.Group;
  pitcher: THREE.Group;
  catcher: THREE.Group;
  fielders: THREE.Group[];
  runners: THREE.Group[];
  all: THREE.Group[];
}

/** Place the seven on-field players (SPEC §4.3) plus base-runner tokens. */
export function buildCast(scene: THREE.Scene): Cast {
  const batter = buildPlayer(PALETTE.blue, PALETTE.blue, true);
  batter.position.set(1.1, 0, 0.2);
  batter.rotation.y = -Math.PI / 2;

  const pitcher = buildPlayer(PALETTE.red, PALETTE.red);
  pitcher.position.set(FIELD.mound.x, 0.5, FIELD.mound.z);
  pitcher.rotation.y = Math.PI;

  const catcher = buildPlayer(PALETTE.red, PALETTE.dark);
  catcher.position.set(0, 0, 2.1);
  catcher.scale.setScalar(0.9);

  const fielders: THREE.Group[] = [];
  const spots: [number, number][] = [
    [10.5, -10.5], // 1B
    [4.5, -15], // 2B
    [-4.5, -15], // SS
    [-10.5, -10.5], // 3B
  ];
  for (const [x, z] of spots) {
    const f = buildPlayer(PALETTE.red, PALETTE.red);
    f.position.set(x, 0, z);
    f.rotation.y = Math.PI;
    fielders.push(f);
  }

  const runners: THREE.Group[] = FIELD.bases.map((b) => {
    const r = buildPlayer(PALETTE.blue, PALETTE.blue);
    r.position.set(b.x, 0.3, b.z);
    r.scale.setScalar(0.85);
    r.visible = false;
    return r;
  });

  const all = [batter, pitcher, catcher, ...fielders, ...runners];
  for (const p of all) {
    p.userData.baseY = p.position.y;
    scene.add(p);
  }
  return { batter, pitcher, catcher, fielders, runners, all };
}

/** Gentle idle bounce for every visible player (SPEC §4.3). */
export function idleBob(cast: Cast, t: number): void {
  cast.all.forEach((p, i) => {
    if (!p.visible) return;
    p.position.y = (p.userData.baseY as number) + Math.abs(Math.sin(t * 2.2 + i * 1.3)) * 0.07;
  });
}
