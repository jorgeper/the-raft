import * as THREE from 'three';
import { flatMat, box, setOnTrail } from '../helpers.js';
import { makeBox } from '../../utils/aabb.js';

// Phase 1 statics (spec §6.1 #1-5). One export per obstacle module pattern:
// these five are trivial statics sharing a file-local `staticDef` helper is
// avoided on purpose — each is its own def for the registry.

const woodMat = () => flatMat(0x5c4630);
const rockMat = () => flatMat(0x8d9091);
const mossMat = () => flatMat(0x6f9448);

export const rootSnarl = {
  name: 'rootSnarl',
  tag: 'soft',
  build(rng) {
    const g = new THREE.Group();
    const m = woodMat();
    for (let i = 0; i < 6; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(rng.range(0.25, 0.6), 0.07, 5, 8, Math.PI * rng.range(0.6, 1)), m);
      r.position.set(rng.range(-1, 1), 0.02, rng.range(-0.5, 0.5));
      r.rotation.set(Math.PI / 2 + rng.range(-0.3, 0.3), rng.range(0, Math.PI), 0);
      r.castShadow = true;
      g.add(r);
    }
    return g;
  },
  place(inst, rng) {
    inst.l = rng.range(-2.5, 2.5);
    const hl = rng.range(1, 1.7);
    inst.group.scale.set(hl, 0.5, hl); // stay shin-high to match the soft hitbox
    setOnTrail(inst.group, inst.s, inst.l);
    inst.boxes = [{ ...makeBox(inst.s, inst.l, 0.12, 0.5, hl, 0.12), kind: 'soft' }];
    return []; // soft: never blocks the survivable path
  },
};

export const smallRock = {
  name: 'smallRock',
  tag: 'soft',
  build(rng) {
    const g = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), rockMat());
    rock.position.y = 0.2;
    rock.scale.y = 0.8;
    rock.castShadow = true;
    const moss = box(0.4, 0.12, 0.4, mossMat(), 0, 0.5, 0);
    moss.castShadow = false;
    g.add(rock, moss);
    return g;
  },
  place(inst, rng) {
    inst.l = rng.range(-3.2, 3.2);
    setOnTrail(inst.group, inst.s, inst.l);
    inst.boxes = [{ ...makeBox(inst.s, inst.l, 0.25, 0.45, 0.45, 0.25), kind: 'soft' }];
    return [];
  },
};

export const boulder = {
  name: 'boulder',
  tag: 'solid',
  build(rng) {
    const g = new THREE.Group();
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 1), rockMat());
    rock.position.y = 0.75;
    rock.scale.set(1.15, 0.95, 1);
    rock.castShadow = true;
    const moss = box(1.2, 0.25, 1.1, mossMat(), 0, 1.45, 0);
    moss.castShadow = false;
    g.add(rock, moss);
    return g;
  },
  place(inst, rng) {
    inst.l = rng.range(-2.8, 2.8);
    inst.group.rotation.y = rng.range(0, Math.PI);
    setOnTrail(inst.group, inst.s, inst.l);
    const hl = 1.1;
    inst.boxes = [{ ...makeBox(inst.s, inst.l, 0.8, 0.9, hl, 0.8), kind: 'solid' }];
    return [{ s: inst.s, hs: 0.9, l: inst.l, hl, jumpable: false }];
  },
};

export const mudPuddle = {
  name: 'mudPuddle',
  tag: 'special',
  build() {
    const g = new THREE.Group();
    const mud = new THREE.Mesh(
      new THREE.CircleGeometry(1, 10),
      flatMat(0x4e3a26, { roughness: 0.35 })
    );
    mud.rotation.x = -Math.PI / 2;
    mud.position.y = 0.02;
    mud.scale.set(1.4, 1, 1);
    g.add(mud);
    return g;
  },
  place(inst, rng) {
    inst.l = rng.range(-2.6, 2.6);
    const r = rng.range(1.1, 1.9);
    inst.group.scale.setScalar(r);
    setOnTrail(inst.group, inst.s, inst.l);
    inst.boxes = [{ ...makeBox(inst.s, inst.l, 0.2, r * 1.3, r * 1.3, 0.25), kind: 'zone' }];
    return [];
  },
  onZone(inst, ctx) {
    // 20% speed drag while wading (spec §6.1) — no stumble
    if (ctx.grounded) {
      ctx.controller.applyDrag(0.8);
      ctx.fx?.mudSplash(inst.s, inst.l);
    }
  },
};

export const fallenBranch = {
  name: 'fallenBranch',
  tag: 'soft',
  build(rng) {
    const g = new THREE.Group();
    const m = woodMat();
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 1, 7), m);
    branch.rotation.z = Math.PI / 2;
    branch.position.y = 0.16;
    branch.castShadow = true;
    g.add(branch);
    for (let i = 0; i < 3; i++) {
      const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, rng.range(0.3, 0.6), 5), m);
      twig.position.set(rng.range(-0.4, 0.4), 0.18, rng.range(-0.1, 0.1));
      twig.rotation.set(rng.range(0.8, 1.6), rng.range(0, 3), rng.range(0.5, 1.2));
      twig.castShadow = true;
      g.add(twig);
    }
    return g;
  },
  place(inst, rng) {
    // spans 30-60% of the trail width from one edge
    const span = rng.range(2.4, 4.8);
    const side = rng.sign();
    inst.l = side * (4 - span / 2);
    inst.group.scale.set(span, 1, 1);
    setOnTrail(inst.group, inst.s, inst.l);
    inst.boxes = [{ ...makeBox(inst.s, inst.l, 0.16, 0.3, span / 2, 0.16), kind: 'soft' }];
    return [];
  },
};
