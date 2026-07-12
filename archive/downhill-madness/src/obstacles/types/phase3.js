import * as THREE from 'three';
import { flatMat, box, setOnTrail, trackPos, buildQuadruped, buildPerson, buildTrunk } from '../helpers.js';
import { makeBox } from '../../utils/aabb.js';
import { clamp, TAU } from '../../utils/math.js';

// Phase 3 — the steep section (spec §6.1 #12-18): timed & moving threats.
// Every one of these telegraphs ≥1 s before occupying the player's line (§6.2).

export const fallingTree = {
  name: 'fallingTree',
  tag: 'solid',
  build(rng) {
    const g = new THREE.Group();
    const tree = new THREE.Group();
    const trunkH = rng.range(7, 9);
    const wood = flatMat(0x6b4a30);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.45, trunkH, 8), wood);
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    tree.add(trunk);
    const green = flatMat(0x4a8a3d);
    let r = 1.9, y = trunkH * 0.45;
    for (let i = 0; i < 4; i++) {
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), green);
      blob.scale.y = 0.7;
      blob.position.y = y;
      blob.castShadow = true;
      tree.add(blob);
      y += r * 0.8; r *= 0.72;
    }
    g.add(tree);
    g.userData = { tree, trunkH };
    return g;
  },
  place(inst, rng) {
    const side = rng.sign();
    inst.l = side * 5.2; // rooted just off-trail
    inst.data = { state: 'standing', side, fallAngle: 0, t: 0, creakT: 0 };
    const { tree } = inst.group.userData;
    tree.rotation.set(0, 0, 0);
    inst.group.rotation.y = 0;
    setOnTrail(inst.group, inst.s, inst.l);
    inst.boxes = [];
    // for fairness: once down it spans the trail as a jumpable trunk
    return [{ s: inst.s, hs: 0.5, l: 0, hl: 4, jumpable: true }];
  },
  update(inst, dt, ctx) {
    const d = inst.data;
    const { tree, trunkH } = inst.group.userData;
    const closing = Math.max(0.1, (inst.s - ctx.playerS) / Math.max(1, ctx.playerSpeed));
    if (d.state === 'standing') {
      if (closing < 1.9 && ctx.playerS < inst.s) {
        d.state = 'creaking';
        ctx.audio?.creak();
      }
    } else if (d.state === 'creaking') {
      d.creakT += dt;
      tree.rotation.z = Math.sin(d.creakT * 24) * 0.02 * d.side; // shudder telegraph
      if (d.creakT > 0.65) {
        d.state = 'falling';
        ctx.audio?.crack();
      }
    } else if (d.state === 'falling') {
      d.fallAngle = Math.min(Math.PI / 2, d.fallAngle + dt * 3.1 * (0.4 + d.fallAngle));
      tree.rotation.z = d.fallAngle * d.side; // pivots at the base, across the trail
      // solid box tracks the trunk's swept position
      const tipL = inst.l - Math.sin(d.fallAngle) * trunkH * d.side;
      const midL = (inst.l + tipL) / 2;
      const y = Math.cos(d.fallAngle) * trunkH * 0.5;
      inst.boxes = [{ ...makeBox(inst.s, midL, Math.max(0.4, y * 0.5), 0.5, Math.abs(tipL - inst.l) / 2 + 0.3, Math.max(0.4, y * 0.5)), kind: 'solid' }];
      if (d.fallAngle >= Math.PI / 2 - 0.01) {
        d.state = 'down';
        ctx.fx?.dustPuff(inst.s, 0);
        // now a waist-high trunk you jump (spec §6.1 #12)
        inst.boxes = [{ ...makeBox(inst.s, inst.l - (trunkH / 2) * d.side, 0.35, 0.42, trunkH / 2, 0.35), kind: 'solid' }];
      }
    }
  },
};

export const biker = {
  name: 'biker',
  tag: 'solid',
  build() {
    const g = new THREE.Group();
    const frameM = flatMat(0xc94f3d);
    const wheelM = flatMat(0x2a2622);
    const w1 = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.06, 6, 12), wheelM);
    const w2 = w1.clone();
    w1.position.set(0, 0.32, -0.55);
    w2.position.set(0, 0.32, 0.45);
    g.add(w1, w2);
    const bar = box(0.08, 0.08, 1, frameM, 0, 0.62, -0.05);
    g.add(bar);
    const rider = buildPerson({ shirt: 0x3a6ea8, pants: 0x2a2622 });
    rider.group.scale.setScalar(0.85);
    rider.group.position.set(0, 0.35, 0.1);
    rider.torso.rotation.x = 0.5; // tucked
    g.add(rider.group);
    const helmet = box(0.24, 0.12, 0.28, flatMat(0xe8c93d), 0, 1.62 * 0.85 + 0.35, 0.02);
    g.add(helmet);
    g.userData = { wheels: [w1, w2] };
    return g;
  },
  place(inst, rng) {
    inst.l = rng.range(-2.6, 2.6); // rides a fixed, predictable line (spec §6.1 #13)
    const oncoming = rng.chance(0.6);
    inst.data = { oncoming, active: !oncoming ? 'waiting' : 'riding', belled: false, v: oncoming ? 8 : 0, t: 0 };
    inst.group.rotation.y = oncoming ? Math.PI : 0;
    setOnTrail(inst.group, inst.s, inst.l);
    inst.boxes = [{ ...makeBox(inst.s, inst.l, 0.8, 0.7, 0.4, 0.8), kind: 'solid' }];
    return [{ s: inst.s, hs: 0.7, l: inst.l, hl: 0.4, jumpable: false }];
  },
  update(inst, dt, ctx) {
    const d = inst.data;
    d.t += dt;
    if (d.active === 'waiting') {
      // overtaker: appears behind once the player is close, then bombs past
      if (inst.s - ctx.playerS < 26) {
        inst.s = ctx.playerS - 24;
        d.v = -Math.min(38, ctx.playerSpeed * 1.35); // negative: moving down-trail
        d.active = 'riding';
      } else return;
    }
    const closing = Math.abs(inst.s - ctx.playerS) / Math.max(6, ctx.playerSpeed + Math.abs(d.v));
    if (!d.belled && closing < 1.4) { d.belled = true; ctx.audio?.bell(); }
    // oncoming rides up-trail toward the player; overtaker bombs down-trail
    inst.s += (d.oncoming ? -8 : Math.abs(d.v)) * dt;
    setOnTrail(inst.group, inst.s, inst.l);
    for (const w of inst.group.userData.wheels) w.rotation.x += dt * 14;
    inst.group.rotation.z = Math.sin(d.t * 9) * 0.03;
    inst.boxes[0].s = inst.s;
  },
};

export const rockslide = {
  name: 'rockslide',
  tag: 'solid',
  build(rng) {
    const g = new THREE.Group();
    const rockM = flatMat(0x8d9091);
    g.userData.rocks = [];
    for (let i = 0; i < 5; i++) {
      const r = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.35, 0.6), 0), rockM);
      r.castShadow = true;
      r.visible = false;
      g.add(r);
      g.userData.rocks.push(r);
    }
    return g;
  },
  place(inst, rng) {
    inst.l = 0;
    const n = rng.int(3, 5);
    inst.data = {
      triggered: false, t: 0, n,
      rocks: Array.from({ length: n }, (_, i) => ({
        delay: i * rng.range(0.25, 0.4),
        speed: rng.range(6, 9),
        s: inst.s + rng.range(-2.5, 2.5),
        l: -7, y: 0.4, radius: rng.range(0.35, 0.6), done: false,
      })),
    };
    inst.group.position.set(0, 0, 0);
    for (const r of inst.group.userData.rocks) r.visible = false;
    inst.boxes = [];
    // fairness: rocks are staggered — model as three thin jumpable-ish gaps;
    // conservatively reserve the middle as blocked-but-jumpable
    return [{ s: inst.s, hs: 2.5, l: 0, hl: 2.5, jumpable: true }];
  },
  update(inst, dt, ctx) {
    const d = inst.data;
    const closing = (inst.s - ctx.playerS) / Math.max(1, ctx.playerSpeed);
    if (!d.triggered) {
      if (closing < 1.6 && ctx.playerS < inst.s) {
        d.triggered = true;
        ctx.audio?.crack();
      } else return;
    }
    d.t += dt;
    inst.boxes = [];
    const meshes = inst.group.userData.rocks;
    d.rocks.forEach((r, i) => {
      const mesh = meshes[i];
      if (!mesh || r.done) { if (mesh) mesh.visible = r.done; return; }
      const t = d.t - r.delay;
      if (t < 0) return;
      mesh.visible = true;
      r.l = -7 + r.speed * t;
      r.y = Math.abs(Math.sin(t * 6)) * 0.7 * Math.max(0.2, 1 - t * 0.35) + r.radius * 0.5;
      if (r.l > 7) { r.done = true; r.l = 7; r.y = r.radius * 0.5; }
      mesh.position.copy(trackPos(r.s, r.l, r.y));
      mesh.rotation.x += dt * 7;
      mesh.rotation.z += dt * 5;
      if (!r.done) {
        inst.boxes.push({ ...makeBox(r.s, r.l, r.y, r.radius, r.radius, r.radius), kind: 'solid' });
      }
    });
  },
};

export const deer = {
  name: 'deer',
  tag: 'solid',
  build() {
    const body = flatMat(0xb5824a);
    const q = buildQuadruped({
      bodyW: 0.45, bodyH: 0.55, bodyL: 1, legH: 0.75, headSize: 0.28,
      bodyMat: body, headMat: body, legMat: flatMat(0x9a6c3d),
    });
    // antlers
    const antM = flatMat(0x7a5a3c);
    for (const side of [-1, 1]) {
      const a = box(0.05, 0.4, 0.05, antM, side * 0.1, 0.5, 0);
      a.rotation.z = side * -0.5;
      q.headPivot.add(a);
    }
    q.group.userData.quad = q;
    return q.group;
  },
  place(inst, rng) {
    inst.l = -6.5; // poised on the hillside
    inst.data = { state: 'idle', t: 0, dir: 1 };
    inst.group.rotation.y = -Math.PI / 2;
    setOnTrail(inst.group, inst.s, inst.l);
    inst.boxes = [];
    // fairness: crosses in bounds — treat as momentary jumpable blocker
    return [{ s: inst.s, hs: 1, l: 0, hl: 4, jumpable: true }];
  },
  update(inst, dt, ctx) {
    const d = inst.data;
    const closing = (inst.s - ctx.playerS) / Math.max(1, ctx.playerSpeed);
    if (d.state === 'idle') {
      if (closing < 1.35 && ctx.playerS < inst.s) d.state = 'leaping';
      else return;
    }
    d.t += dt;
    // two bounds across the full trail in ~1.1 s (spec §6.1 #15)
    const T = 1.1;
    const p = clamp(d.t / T, 0, 1);
    inst.l = -6.5 + p * 13;
    const hop = Math.abs(Math.sin(p * Math.PI * 2)); // two arcs
    const y = hop * 1.5;
    setOnTrail(inst.group, inst.s, inst.l, y);
    const q = inst.group.userData.quad;
    q.legs.forEach((leg, i) => { leg.rotation.x = (i < 2 ? -1 : 1) * (0.6 + hop * 0.5); });
    inst.group.rotation.z = Math.sin(p * Math.PI * 2) * 0.2;
    if (p >= 1) { d.state = 'gone'; inst.boxes = []; inst.group.visible = false; return; }
    inst.boxes = [{ ...makeBox(inst.s, inst.l, y + 0.75, 0.6, 0.6, 0.75), kind: 'solid' }];
  },
};

export const picnic = {
  name: 'picnic',
  tag: 'solid',
  build(rng) {
    const g = new THREE.Group();
    const blanket = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.2), flatMat(0xc94f3d));
    blanket.rotation.x = -Math.PI / 2;
    blanket.position.y = 0.03;
    // checker pattern via a second smaller plane
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.5), flatMat(0xf0ead8));
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.04;
    g.add(blanket, inner);
    const basket = box(0.4, 0.3, 0.3, flatMat(0xa5793d), 0.6, 0.18, 0.4);
    g.add(basket);
    const n = rng.int(2, 3);
    for (let i = 0; i < n; i++) {
      const p = buildPerson({ shirt: [0xd98a3d, 0x5a8ac9, 0x8a5aa5][i % 3], pants: 0x6b5b45 });
      // seated: sink them and fold the legs forward
      p.group.position.set(-0.6 + i * 0.7, -0.55, -0.3 + (i % 2) * 0.5);
      p.legL.rotation.x = -1.4;
      p.legR.rotation.x = -1.4;
      p.armR.rotation.x = i === 0 ? -1.8 : -0.3; // one waves hello
      g.add(p.group);
    }
    return g;
  },
  place(inst, rng) {
    inst.l = rng.sign() * rng.range(1.8, 2.6);
    inst.group.rotation.y = rng.range(0, TAU);
    setOnTrail(inst.group, inst.s, inst.l);
    const hl = 1.5;
    inst.boxes = [{ ...makeBox(inst.s, inst.l, 0.5, 1.2, hl, 0.5), kind: 'solid' }];
    return [{ s: inst.s, hs: 1.2, l: inst.l, hl, jumpable: false }];
  },
};

export const narrows = {
  name: 'narrows',
  tag: 'special',
  build(rng) {
    const g = new THREE.Group();
    g.userData = { built: false };
    return g;
  },
  place(inst, rng) {
    const length = rng.range(20, 30);
    inst.l = 0;
    inst.data = { sStart: inst.s, sEnd: inst.s + length, halfWidth: 1.75 };
    // rebuild fence + rocks for this placement (dispose the old build)
    const g = inst.group;
    while (g.children.length) {
      const child = g.children[0];
      child.traverse?.((o) => o.geometry?.dispose());
      child.geometry?.dispose();
      g.remove(child);
    }
    g.position.set(0, 0, 0);
    const postM = flatMat(0x7a5a3c);
    const railM = flatMat(0x8a6a45);
    const rockM = flatMat(0x8d9091);
    const rects = [];
    for (let s = inst.s; s <= inst.s + length; s += 3) {
      // fence on the right (drop side)
      const post = box(0.12, 1, 0.12, postM);
      post.position.copy(trackPos(s, 2.1, 0.5));
      g.add(post);
      const rail = box(0.08, 0.08, 3, railM);
      rail.position.copy(trackPos(s + 1.5, 2.1, 0.85));
      const a = trackPos(s, 2.1, 0.85), b = trackPos(s + 3, 2.1, 0.85);
      rail.lookAt(b.x, b.y, b.z);
      rail.position.copy(a.lerp(b, 0.5));
      g.add(rail);
      // boulders crowd the left
      const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(rng.range(0.8, 1.4), 0), rockM);
      rock.position.copy(trackPos(s + rng.range(0, 2), rng.range(-3.4, -2.6), 0.4));
      rock.castShadow = true;
      g.add(rock);
      rects.push({ s, hs: 1.6, l: -3, hl: 1.2, jumpable: false });
      rects.push({ s, hs: 1.6, l: 3, hl: 1.2, jumpable: false });
    }
    inst.boxes = []; // the squeeze is enforced via the zone, not collision
    return rects;
  },
  zone(inst) {
    return inst.data; // { sStart, sEnd, halfWidth } — game clamps steering
  },
};

export const logRamp = {
  name: 'logRamp',
  tag: 'special',
  build(rng) {
    const g = new THREE.Group();
    const ramp = buildTrunk(3.4, 0.5);
    ramp.rotation.z = 0; // trunk lies across the slope direction:
    ramp.rotation.y = Math.PI / 2; // align along the trail
    ramp.rotation.x = -0.35; // tilted: uphill end buried, downhill end up
    ramp.position.y = 0.35;
    g.add(ramp);
    const dirt = new THREE.Mesh(new THREE.CircleGeometry(1, 8), flatMat(0x6f5436));
    dirt.rotation.x = -Math.PI / 2;
    dirt.position.set(0, 0.02, 1.4);
    g.add(dirt);
    return g;
  },
  place(inst, rng) {
    inst.l = rng.range(-2.8, 2.8);
    setOnTrail(inst.group, inst.s, inst.l);
    inst.data = { used: false };
    inst.boxes = [{ ...makeBox(inst.s, inst.l, 0.4, 1.4, 1, 0.5), kind: 'zone' }];
    return []; // an opportunity, not a blocker
  },
  onZone(inst, ctx) {
    if (!ctx.grounded || inst.data.used) return;
    inst.data.used = true;
    // jump on it → ×1.6 launch; run over it → ×1.3 auto-launch (spec §4.3)
    const viaJump = ctx.jumpBuffered;
    ctx.controller.rampLaunch(viaJump ? 1.6 : 1.3, true);
    ctx.audio?.bigJump();
    setTimeout(() => { inst.data.used = false; }, 1500);
  },
};
