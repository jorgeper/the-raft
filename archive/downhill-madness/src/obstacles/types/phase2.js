import * as THREE from 'three';
import {
  flatMat, box, setOnTrail, trackPos, buildQuadruped, animateWalk,
  buildPerson, buildTrunk, holsteinTexture,
} from '../helpers.js';
import { makeBox } from '../../utils/aabb.js';
import { clamp, TAU } from '../../utils/math.js';

// Phase 2 — deep forest (spec §6.1 #6-11): the animals arrive.

export const sheep = {
  name: 'sheep',
  tag: 'soft',
  build() {
    const wool = flatMat(0xf0ead8);
    const face = flatMat(0x3d3630);
    const q = buildQuadruped({
      bodyW: 0.55, bodyH: 0.5, bodyL: 0.75, legH: 0.3, headSize: 0.26,
      bodyMat: wool, headMat: face, legMat: face, earMat: face, fluffy: true,
    });
    q.group.userData.quad = q;
    return q.group;
  },
  place(inst, rng) {
    inst.l = rng.range(-3, 3);
    inst.data = {
      t: rng.range(0, 10), wanderDir: rng.sign(), fled: false, hitSpin: 0,
      baseL: inst.l, scatterAwarded: false,
    };
    inst.group.rotation.set(0, rng.range(0, TAU), 0);
    inst.group.scale.setScalar(rng.range(0.9, 1.1));
    setOnTrail(inst.group, inst.s, inst.l);
    inst.boxes = [{ ...makeBox(inst.s, inst.l, 0.4, 0.5, 0.5, 0.4), kind: 'soft' }];
    return [];
  },
  update(inst, dt, ctx) {
    const d = inst.data;
    d.t += dt;
    const q = inst.group.userData.quad;
    if (d.hitSpin > 0) {
      // comic tumble, then recover (spec §6.1 #6)
      d.hitSpin -= dt;
      inst.group.rotation.x += dt * 9;
      inst.group.position.y += Math.sin(d.hitSpin * 10) * 0.02;
      if (d.hitSpin <= 0) inst.group.rotation.x = 0;
      return;
    }
    const dist = Math.abs(ctx.playerS - inst.s);
    const lateralGap = Math.abs(ctx.playerL - inst.l);
    if (!d.fled && dist < 3 && lateralGap < 2.2) {
      d.fled = true;
      ctx.audio?.bleat();
      if (lateralGap < 1.4 && !d.scatterAwarded) {
        d.scatterAwarded = true;
        ctx.addStyle?.('SCATTER', 'scatter', inst);
      }
    }
    if (d.fled) {
      const dir = Math.sign(inst.l - ctx.playerL) || 1;
      inst.l = clamp(inst.l + dir * 4.5 * dt, -6, 6);
      inst.group.rotation.y = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
      animateWalk(q, d.t * 22, 0.9);
    } else {
      inst.l = d.baseL + Math.sin(d.t * 0.5) * 1.1 * d.wanderDir;
      inst.group.rotation.y += Math.sin(d.t * 0.23) * 0.01;
      animateWalk(q, d.t * 4, 0.35);
      q.headPivot.rotation.x = Math.sin(d.t * 0.9) * 0.3 + 0.25; // grazing
    }
    setOnTrail(inst.group, inst.s, inst.l);
    inst.boxes[0].l = inst.l;
  },
  onHit(inst, ctx) {
    inst.data.hitSpin = 0.9;
    inst.data.fled = true;
    ctx.audio?.bleat();
    return 'stumble';
  },
};

export const cow = {
  name: 'cow',
  tag: 'solid',
  build() {
    const hide = new THREE.MeshStandardMaterial({ map: holsteinTexture(), roughness: 0.9, flatShading: true });
    const face = flatMat(0xe8dcc8);
    const legs = flatMat(0x3a3230);
    const q = buildQuadruped({
      bodyW: 0.85, bodyH: 0.85, bodyL: 1.7, legH: 0.6, headSize: 0.42,
      bodyMat: hide, headMat: face, legMat: legs, earMat: legs,
    });
    q.group.userData.quad = q;
    return q.group;
  },
  place(inst, rng) {
    // stands broadside across up to half the trail (spec §6.1 #7)
    inst.l = rng.sign() * rng.range(1.2, 2.6);
    inst.data = { t: rng.range(0, 10) };
    inst.group.rotation.y = Math.PI / 2 + rng.range(-0.3, 0.3);
    inst.group.scale.setScalar(rng.range(0.95, 1.1));
    setOnTrail(inst.group, inst.s, inst.l);
    const hl = 1.15;
    inst.boxes = [{ ...makeBox(inst.s, inst.l, 0.75, 0.55, hl, 0.75), kind: 'solid' }];
    return [{ s: inst.s, hs: 0.55, l: inst.l, hl, jumpable: false }];
  },
  update(inst, dt, ctx) {
    const d = inst.data;
    d.t += dt;
    const q = inst.group.userData.quad;
    q.headPivot.rotation.x = 0.15 + Math.sin(d.t * 2.4) * 0.08; // chewing bob
    q.tail.rotation.z = Math.sin(d.t * 1.7) * 0.6; // tail flick
    if (!d.mooed && Math.abs(ctx.playerS - inst.s) < 12) { d.mooed = true; ctx.audio?.moo(); }
  },
};

export const hiker = {
  name: 'hiker',
  tag: 'solid',
  build(rng) {
    const g = new THREE.Group();
    const colors = [[0xb5563c, 0x4a5568], [0x4a7ab5, 0x6b5b45], [0xc9a53d, 0x3d5a45]];
    const n = rng.chance(0.45) ? 2 : 1;
    g.userData.people = [];
    for (let i = 0; i < n; i++) {
      const [shirt, pants] = colors[rng.int(0, colors.length - 1)];
      const p = buildPerson({ shirt, pants, hat: rng.chance(0.6) ? 0xd9b86a : null });
      p.group.position.x = i * 0.85;
      // trekking poles
      const poleM = flatMat(0x999999);
      for (const side of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 5), poleM);
        pole.position.set(side * 0.3, 0.55, -0.15);
        p.group.add(pole);
      }
      g.add(p.group);
      g.userData.people.push(p);
    }
    g.userData.count = n;
    return g;
  },
  place(inst, rng) {
    const n = inst.group.userData.count;
    inst.l = rng.range(-2.8, 2.8 - (n - 1) * 0.85);
    inst.data = { t: rng.range(0, 10) };
    inst.group.rotation.y = Math.PI; // facing uphill, toward the player
    setOnTrail(inst.group, inst.s, inst.l);
    const hl = 0.45 + (n - 1) * 0.45;
    // the group is rotated π, so person i sits at world lateral inst.l - i·0.85
    const boxL = inst.l - ((n - 1) * 0.85) / 2;
    inst.boxes = [{ ...makeBox(inst.s, boxL, 0.85, 0.35, hl, 0.85), kind: 'solid' }];
    return [{ s: inst.s, hs: 0.35, l: boxL, hl, jumpable: false }];
  },
  update(inst, dt, ctx) {
    const d = inst.data;
    d.t += dt;
    // walks uphill toward the player (spec §6.1 #8)
    inst.s -= 1.3 * dt;
    setOnTrail(inst.group, inst.s, inst.l);
    inst.boxes[0].s = inst.s;
    for (const p of inst.group.userData.people) {
      p.legL.rotation.x = Math.sin(d.t * 5) * 0.5;
      p.legR.rotation.x = -Math.sin(d.t * 5) * 0.5;
      p.armL.rotation.x = -Math.sin(d.t * 5) * 0.4;
      p.armR.rotation.x = Math.sin(d.t * 5) * 0.4;
    }
  },
};

export const dogLeash = {
  name: 'dogLeash',
  tag: 'special',
  build() {
    const g = new THREE.Group();
    const owner = buildPerson({ shirt: 0x7a4a8a, pants: 0x4a5568, hat: 0xc94f3d });
    g.add(owner.group);
    const dogBody = flatMat(0xa5793d);
    const dog = buildQuadruped({
      bodyW: 0.28, bodyH: 0.3, bodyL: 0.5, legH: 0.22, headSize: 0.2,
      bodyMat: dogBody, headMat: dogBody, legMat: flatMat(0x8a6330),
    });
    g.add(dog.group);
    const leash = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 5), flatMat(0xc9483a));
    g.add(leash);
    g.userData = { owner, dog, leash };
    return g;
  },
  place(inst, rng) {
    // owner one side, dog the other, taut leash at shin height (spec §6.1 #9)
    const span = rng.range(2.6, 4);
    const center = rng.range(-(3.6 - span / 2), 3.6 - span / 2);
    const ownerL = center - span / 2;
    const dogL = center + span / 2;
    inst.l = center;
    inst.data = { t: 0, ownerL, dogL, span, yipped: false };
    const { owner, dog, leash } = inst.group.userData;
    inst.group.position.set(0, 0, 0);
    inst.group.rotation.set(0, 0, 0);
    inst.group.scale.setScalar(1);
    owner.group.position.copy(trackPos(inst.s, ownerL));
    owner.group.rotation.y = Math.PI / 2;
    dog.group.position.copy(trackPos(inst.s, dogL));
    dog.group.rotation.y = -Math.PI / 2;
    const a = trackPos(inst.s, ownerL + 0.2, 0.85);
    const b = trackPos(inst.s, dogL - 0.15, 0.42);
    const mid = a.clone().lerp(b, 0.5);
    leash.position.copy(mid);
    leash.scale.y = a.distanceTo(b);
    leash.lookAt(b);
    leash.rotateX(Math.PI / 2);
    inst.boxes = [
      { ...makeBox(inst.s, ownerL, 0.85, 0.35, 0.35, 0.85), kind: 'solid' },
      { ...makeBox(inst.s, dogL, 0.25, 0.4, 0.35, 0.25), kind: 'solid' },
      // the tripwire: shin height — jump it (soft on contact)
      { ...makeBox(inst.s, center, 0.55, 0.12, span / 2 - 0.3, 0.28), kind: 'soft' },
    ];
    return [
      { s: inst.s, hs: 0.35, l: ownerL, hl: 0.35, jumpable: false },
      { s: inst.s, hs: 0.4, l: dogL, hl: 0.35, jumpable: false },
      { s: inst.s, hs: 0.12, l: center, hl: span / 2 - 0.3, jumpable: true },
    ];
  },
  update(inst, dt, ctx) {
    const d = inst.data;
    d.t += dt;
    const { dog } = inst.group.userData;
    animateWalk(inst.group.userData.dog, d.t * 8, 0.3);
    dog.tail.rotation.z = Math.sin(d.t * 14) * 0.7; // happy tail
    if (!d.yipped && Math.abs(ctx.playerS - inst.s) < 14) {
      d.yipped = true;
      ctx.audio?.cluck?.();
    }
  },
};

export const log = {
  name: 'log',
  tag: 'solid',
  build(rng) {
    const g = new THREE.Group();
    g.add(buildTrunk(rng.range(3.2, 5.6), rng.range(0.38, 0.48)));
    g.userData.length = 4.4;
    return g;
  },
  place(inst, rng) {
    // waist-high trunk spanning 40-70% of the width — jump it or go around (spec §6.1 #10)
    const span = rng.range(3.2, 5.6);
    const side = rng.sign();
    inst.l = side * (4 - span / 2) * rng.range(0.4, 1);
    inst.group.scale.setScalar(1);
    inst.group.rotation.y = rng.range(-0.15, 0.15);
    setOnTrail(inst.group, inst.s, inst.l, 0.42);
    const hl = span / 2;
    inst.boxes = [{ ...makeBox(inst.s, inst.l, 0.45, 0.48, hl, 0.45), kind: 'solid' }];
    return [{ s: inst.s, hs: 0.48, l: inst.l, hl, jumpable: true }];
  },
};

export const stream = {
  name: 'stream',
  tag: 'special',
  build(rng) {
    const g = new THREE.Group();
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 2.5),
      new THREE.MeshStandardMaterial({ color: 0x4d9ec9, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.85 })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.12;
    g.add(water);
    const stoneM = flatMat(0x9a9d9e);
    for (let i = 0; i < 6; i++) {
      const st = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.25, 0.4), 0), stoneM);
      st.position.set(rng.range(-5, 5), -0.05, rng.range(-0.8, 0.8));
      st.scale.y = 0.5;
      st.castShadow = true;
      g.add(st);
    }
    g.userData.water = water;
    return g;
  },
  place(inst, rng) {
    inst.l = 0;
    inst.data = { t: rng.range(0, 9) };
    setOnTrail(inst.group, inst.s, 0);
    inst.boxes = [{ ...makeBox(inst.s, 0, 0.15, 1.25, 7, 0.2), kind: 'zone' }];
    return []; // jump it or splash — never lethal
  },
  update(inst, dt) {
    inst.data.t += dt;
    inst.group.userData.water.position.y = -0.12 + Math.sin(inst.data.t * 2.2) * 0.015;
  },
  onZone(inst, ctx) {
    if (ctx.grounded && !inst.data.splashed) {
      inst.data.splashed = true; // once per crossing
      ctx.audio?.splash();
      ctx.fx?.waterSplash(inst.s, ctx.playerL);
      ctx.controller.stumble('stream');
      setTimeout(() => { inst.data.splashed = false; }, 1200);
    }
  },
};
