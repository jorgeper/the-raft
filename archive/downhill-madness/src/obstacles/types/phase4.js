import * as THREE from 'three';
import { flatMat, box, setOnTrail, trackPos, buildPerson, buildTrunk } from '../helpers.js';
import { makeBox } from '../../utils/aabb.js';
import { clamp, TAU } from '../../utils/math.js';

// Phase 4 — golden chaos (spec §6.1 #19-24). Still cozy, just absurd.

export const rollingLog = {
  name: 'rollingLog',
  tag: 'solid',
  build() {
    const g = new THREE.Group();
    const log = buildTrunk(9, 0.36);
    g.add(log);
    g.userData.log = log;
    return g;
  },
  place(inst, rng) {
    inst.l = 0;
    inst.data = { state: 'waiting', t: 0 };
    inst.group.visible = false;
    setOnTrail(inst.group, inst.s, 0, 0.36);
    inst.boxes = [];
    return [{ s: inst.s, hs: 1, l: 0, hl: 4.4, jumpable: true }];
  },
  update(inst, dt, ctx) {
    const d = inst.data;
    const closing = (inst.s - ctx.playerS) / Math.max(1, ctx.playerSpeed);
    if (d.state === 'waiting') {
      // telegraph: rumble into view 1.6 s out (spec §6.2)
      if (closing < 1.6 && ctx.playerS < inst.s) {
        d.state = 'rolling';
        inst.group.visible = true;
        ctx.audio?.creak();
      } else return;
    }
    if (d.state !== 'rolling') return;
    d.t += dt;
    inst.s -= 6.5 * dt; // rolls up-trail toward the player — cartoon physics
    setOnTrail(inst.group, inst.s, 0, 0.36);
    inst.group.userData.log.rotation.x -= dt * 9;
    inst.group.rotation.y = Math.sin(d.t * 3) * 0.03;
    inst.boxes = [{ ...makeBox(inst.s, 0, 0.36, 0.4, 4.4, 0.36), kind: 'solid' }];
    if (inst.s < ctx.playerS - 25) { d.state = 'gone'; inst.group.visible = false; inst.boxes = []; }
  },
};

export const beeSwarm = {
  name: 'beeSwarm',
  tag: 'special',
  build(rng) {
    const g = new THREE.Group();
    const beeM = new THREE.MeshBasicMaterial({ color: 0x3a3220 });
    const wingM = new THREE.MeshBasicMaterial({ color: 0xfff8dd, transparent: true, opacity: 0.7 });
    g.userData.bees = [];
    for (let i = 0; i < 26; i++) {
      const bee = new THREE.Group();
      const b = box(0.09, 0.07, 0.12, beeM);
      b.castShadow = false;
      const w = box(0.14, 0.02, 0.08, wingM, 0, 0.05, 0);
      w.castShadow = false;
      bee.add(b, w);
      bee.userData = { ph: rng.range(0, TAU), r: rng.range(0.3, 1.1), h: rng.range(-0.6, 0.6), sp: rng.range(2, 5) };
      g.add(bee);
      g.userData.bees.push(bee);
    }
    return g;
  },
  place(inst, rng) {
    inst.l = rng.range(-2.4, 2.4);
    inst.data = { t: rng.range(0, 20), baseL: inst.l, buzzed: false };
    setOnTrail(inst.group, inst.s, inst.l, 1.2);
    inst.boxes = [{ ...makeBox(inst.s, inst.l, 1, 0.9, 0.9, 0.9), kind: 'zone' }];
    return [];
  },
  update(inst, dt, ctx) {
    const d = inst.data;
    d.t += dt;
    inst.l = d.baseL + Math.sin(d.t * 0.7) * 1.3; // drifts across the trail
    setOnTrail(inst.group, inst.s, inst.l, 1.2);
    for (const bee of inst.group.userData.bees) {
      const u = bee.userData;
      bee.position.set(
        Math.cos(d.t * u.sp + u.ph) * u.r,
        u.h + Math.sin(d.t * u.sp * 1.3 + u.ph) * 0.25,
        Math.sin(d.t * u.sp + u.ph) * u.r * 0.8
      );
    }
    inst.boxes[0].l = inst.l;
    if (!d.buzzed && Math.abs(ctx.playerS - inst.s) < 10) { d.buzzed = true; ctx.audio?.buzz(true); }
  },
  onZone(inst, ctx) {
    if (inst.data.stung) return;
    inst.data.stung = true;
    // sting + smeared vision for 1.5 s (spec §6.1 #20)
    ctx.controller.stumble('bees');
    ctx.hud?.stingVision(1.5);
    ctx.audio?.buzz(true);
    setTimeout(() => { inst.data.stung = false; }, 2000);
  },
};

export const ranger = {
  name: 'ranger',
  tag: 'solid',
  build() {
    const g = new THREE.Group();
    g.userData.parts = { horses: [], ranger: null, sign: null };
    const woodM = flatMat(0xc9a53d);
    const stripeM = flatMat(0xd9d4c8);
    for (let i = 0; i < 3; i++) {
      const horse = new THREE.Group();
      const bar = box(0.14, 0.22, 2.3, woodM, 0, 1.05, 0);
      const stripe = box(0.15, 0.11, 2.3, stripeM, 0, 1.05, 0);
      stripe.castShadow = false;
      horse.add(bar, stripe);
      for (const e of [-1, 1]) {
        const leg1 = box(0.09, 1.15, 0.09, woodM, 0.18, 0.55, e * 1.05);
        const leg2 = box(0.09, 1.15, 0.09, woodM, -0.18, 0.55, e * 1.05);
        leg1.rotation.z = 0.18; leg2.rotation.z = -0.18;
        horse.add(leg1, leg2);
      }
      g.add(horse);
      g.userData.parts.horses.push(horse);
    }
    const person = buildPerson({ shirt: 0x5a7d3a, pants: 0x6b5b45, hat: 0x8a6a45 });
    g.add(person.group);
    g.userData.parts.ranger = person;
    // STOP sign on a stick
    const sign = new THREE.Group();
    const stick = box(0.04, 0.9, 0.04, flatMat(0x8a6a45), 0, 0.45, 0);
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 8), flatMat(0xc9483a));
    face.rotation.x = Math.PI / 2;
    face.position.y = 1;
    sign.add(stick, face);
    sign.position.set(0.05, 1.26, 0);
    person.armR.add(sign);
    person.armR.rotation.x = -2.4;
    g.userData.parts.sign = sign;
    return g;
  },
  place(inst, rng) {
    // barriers span all but one 2 m gap (spec §6.1 #21)
    const gapCenter = rng.range(-2.6, 2.6);
    inst.l = gapCenter;
    inst.data = { t: 0, gapCenter };
    const { horses, ranger: person } = inst.group.userData.parts;
    inst.group.position.set(0, 0, 0);
    const rects = [];
    inst.boxes = [];
    // fill [-4, 4] minus (gapCenter ± 1)
    const segments = [[-4.4, gapCenter - 1], [gapCenter + 1, 4.4]];
    let hi = 0;
    for (const [a, b] of segments) {
      if (b - a < 0.8) continue;
      const mid = (a + b) / 2, half = (b - a) / 2;
      const horse = horses[hi++];
      if (!horse) continue;
      horse.visible = true;
      horse.position.copy(trackPos(inst.s, mid));
      horse.rotation.y = Math.PI / 2;
      horse.scale.set(1, 1, half / 1.15);
      inst.boxes.push({ ...makeBox(inst.s, mid, 0.7, 0.3, half, 0.7), kind: 'solid' });
      rects.push({ s: inst.s, hs: 0.3, l: mid, hl: half, jumpable: false });
    }
    for (let i = hi; i < horses.length; i++) horses[i].visible = false;
    person.group.position.copy(trackPos(inst.s + 1.2, clamp(gapCenter + 2.4, -3.4, 3.4)));
    person.group.rotation.y = Math.PI;
    inst.boxes.push({ ...makeBox(inst.s + 1.2, clamp(gapCenter + 2.4, -3.4, 3.4), 0.85, 0.35, 0.35, 0.85), kind: 'solid' });
    rects.push({ s: inst.s + 1.2, hs: 0.35, l: clamp(gapCenter + 2.4, -3.4, 3.4), hl: 0.35, jumpable: false });
    return rects;
  },
  update(inst, dt, ctx) {
    inst.data.t += dt;
    const person = inst.group.userData.parts.ranger;
    person.armR.rotation.z = Math.sin(inst.data.t * 6) * 0.5; // frantic waving
    if (!inst.data.hollered && Math.abs(ctx.playerS - inst.s) < 18) {
      inst.data.hollered = true;
      ctx.audio?.bell();
    }
  },
};

export const slalom = {
  name: 'slalom',
  tag: 'solid',
  build() {
    const g = new THREE.Group();
    g.userData.trees = [];
    const wood = flatMat(0x6b4a30);
    const green = flatMat(0x4a8a3d);
    for (let i = 0; i < 8; i++) {
      const tree = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 5.5, 7), wood);
      trunk.position.y = 2.75;
      trunk.castShadow = true;
      tree.add(trunk);
      let r = 1.5, y = 3.4;
      for (let b = 0; b < 3; b++) {
        const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), green);
        blob.scale.y = 0.65;
        blob.position.y = y;
        blob.castShadow = true;
        tree.add(blob);
        y += r * 0.75; r *= 0.7;
      }
      g.add(tree);
      g.userData.trees.push(tree);
    }
    return g;
  },
  place(inst, rng) {
    // 40 m of alternating trunks in the trail — rhythm steering (spec §6.1 #22)
    inst.l = 0;
    const rects = [];
    inst.boxes = [];
    const trees = inst.group.userData.trees;
    const n = rng.int(6, 8);
    for (let i = 0; i < trees.length; i++) {
      const tree = trees[i];
      if (i >= n) { tree.visible = false; continue; }
      tree.visible = true;
      const s = inst.s + i * (40 / n);
      const l = (i % 2 === 0 ? -1 : 1) * rng.range(1.2, 1.9);
      tree.position.copy(trackPos(s, l));
      inst.boxes.push({ ...makeBox(s, l, 1.5, 0.45, 0.45, 1.5), kind: 'solid' });
      rects.push({ s, hs: 0.45, l, hl: 0.45, jumpable: false });
    }
    inst.span = 40;
    return rects;
  },
};

export const chickens = {
  name: 'chickens',
  tag: 'soft',
  build(rng) {
    const g = new THREE.Group();
    g.userData.birds = [];
    for (let i = 0; i < 10; i++) {
      const bird = new THREE.Group();
      const bodyM = flatMat(rng.chance(0.7) ? 0xf0ead8 : 0xb5793d);
      const body = box(0.22, 0.22, 0.3, bodyM, 0, 0.2, 0);
      const head = box(0.13, 0.15, 0.13, bodyM, 0, 0.4, -0.14);
      const comb = box(0.04, 0.07, 0.09, flatMat(0xc9483a), 0, 0.5, -0.14);
      const beak = box(0.05, 0.04, 0.07, flatMat(0xe8a53d), 0, 0.4, -0.24);
      const wingL = box(0.04, 0.14, 0.2, bodyM, -0.13, 0.22, 0);
      const wingR = box(0.04, 0.14, 0.2, bodyM, 0.13, 0.22, 0);
      comb.castShadow = beak.castShadow = false;
      bird.add(body, head, comb, beak, wingL, wingR);
      bird.userData = { wingL, wingR, ph: rng.range(0, TAU), fled: false };
      g.add(bird);
      g.userData.birds.push(bird);
    }
    return g;
  },
  place(inst, rng) {
    inst.l = rng.range(-2, 2);
    inst.data = { t: rng.range(0, 10), scattered: false, offsets: [] };
    const birds = inst.group.userData.birds;
    inst.group.position.set(0, 0, 0);
    inst.boxes = [];
    for (const bird of birds) {
      const off = { ds: rng.range(-1.6, 1.6), dl: rng.range(-1.5, 1.5), fleeDir: rng.sign() };
      inst.data.offsets.push(off);
      bird.visible = true;
      bird.userData.fled = false;
      bird.position.copy(trackPos(inst.s + off.ds, inst.l + off.dl));
      bird.rotation.y = rng.range(0, TAU);
      inst.boxes.push({ ...makeBox(inst.s + off.ds, inst.l + off.dl, 0.2, 0.25, 0.25, 0.25), kind: 'soft' });
    }
    return [];
  },
  update(inst, dt, ctx) {
    const d = inst.data;
    d.t += dt;
    const birds = inst.group.userData.birds;
    const near = Math.abs(ctx.playerS - inst.s) < 4;
    if (near && !d.scattered) {
      d.scattered = true;
      ctx.audio?.cluck();
      if (Math.abs(ctx.playerL - inst.l) < 2.2) ctx.addStyle?.('SCATTER', 'scatter', inst);
    }
    birds.forEach((bird, i) => {
      const off = d.offsets[i];
      if (!off) return;
      if (d.scattered && !bird.userData.fled) {
        off.dl += off.fleeDir * 5 * dt;
        off.ds += 1.5 * dt;
        bird.position.copy(trackPos(inst.s + off.ds, inst.l + off.dl, Math.abs(Math.sin(d.t * 12 + i)) * 0.3));
        bird.rotation.y = off.fleeDir > 0 ? -Math.PI / 2 : Math.PI / 2;
        bird.userData.wingL.rotation.z = Math.sin(d.t * 30) * 0.9;
        bird.userData.wingR.rotation.z = -Math.sin(d.t * 30) * 0.9;
        if (Math.abs(off.dl) > 7) bird.userData.fled = true;
        if (inst.boxes[i]) { inst.boxes[i].l = inst.l + off.dl; inst.boxes[i].s = inst.s + off.ds; }
      } else if (!d.scattered) {
        bird.position.y = trackPos(inst.s + off.ds, inst.l + off.dl).y + (Math.sin(d.t * 3 + i * 2) > 0.7 ? 0.05 : 0); // pecking
      }
    });
  },
  onHit(inst, ctx) {
    ctx.audio?.cluck();
    return 'stumble';
  },
};

export const waterfall = {
  name: 'waterfall',
  tag: 'special',
  build(rng) {
    const g = new THREE.Group();
    // cascading white sheets on the left hillside
    const fallM = new THREE.MeshStandardMaterial({ color: 0xdfeef5, roughness: 0.3, transparent: true, opacity: 0.85 });
    for (let i = 0; i < 3; i++) {
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1.4 - i * 0.3, 7), fallM);
      sheet.position.set(-0.4 * i, 4.5 - i * 0.6, i * 0.25);
      sheet.rotation.x = 0.12;
      g.add(sheet);
    }
    // mist wall across the trail
    const mistM = new THREE.MeshBasicMaterial({ color: 0xf2f8fa, transparent: true, opacity: 0.5, depthWrite: false, fog: false });
    const mist = new THREE.Mesh(new THREE.PlaneGeometry(11, 4.5), mistM);
    mist.position.set(3, 2, 0);
    mist.rotation.y = Math.PI / 2;
    g.add(mist);
    const pool = new THREE.Mesh(new THREE.CircleGeometry(1.6, 10), flatMat(0x4d9ec9, { roughness: 0.15 }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.04;
    g.add(pool);
    g.userData.mist = mist;
    return g;
  },
  place(inst, rng) {
    inst.l = 0;
    inst.data = { t: 0, soaked: false };
    // the falls live on the left hillside, mist drifts across the trail
    const anchor = trackPos(inst.s, -6.5);
    inst.group.position.copy(anchor);
    inst.group.rotation.y = Math.PI / 2;
    inst.boxes = [{ ...makeBox(inst.s, 0, 1.5, 1, 4.4, 1.5), kind: 'zone' }];
    return [];
  },
  update(inst, dt, ctx) {
    inst.data.t += dt;
    const mist = inst.group.userData.mist;
    mist.material.opacity = 0.42 + Math.sin(inst.data.t * 1.8) * 0.1;
  },
  onZone(inst, ctx) {
    if (inst.data.soaked) return;
    inst.data.soaked = true;
    ctx.hud?.whiteout(1.0); // vision whites out ~1 s (spec §6.1 #24)
    ctx.audio?.splash();
    setTimeout(() => { inst.data.soaked = false; }, 1600);
  },
};
