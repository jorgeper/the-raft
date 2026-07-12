import * as THREE from 'three';
import { makeRng } from '../utils/rng.js';
import { trackPos } from '../obstacles/helpers.js';
import { clamp, TAU } from '../utils/math.js';

// Particles & cozy ambience: dust puffs, splashes, dizzy stars, butterflies,
// pollen motes, drifting golden leaves (spec §7, §7.1). Everything pooled.

const rng = makeRng(4242);

function makeBurst(worldGroup, color, count, size) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0.9, depthWrite: false });
  const points = new THREE.Points(geo, mat);
  points.visible = false;
  points.frustumCulled = false;
  worldGroup.add(points);
  return { points, vels: new Float32Array(count * 3), life: 0, maxLife: 1, count };
}

export function createFx(worldGroup) {
  const bursts = [];
  const burstPools = { dust: [], mud: [], water: [] };
  const colors = { dust: 0xc9b18a, mud: 0x5e4630, water: 0xbfe3f2 };

  function burst(kind, s, l, y = 0.3, spread = 2.4, up = 2.5) {
    const pool = burstPools[kind];
    const b = pool.pop() || makeBurst(worldGroup, colors[kind], 26, kind === 'dust' ? 0.22 : 0.14);
    const origin = trackPos(s, l, y);
    const pos = b.points.geometry.attributes.position.array;
    for (let i = 0; i < b.count; i++) {
      pos[i * 3] = origin.x; pos[i * 3 + 1] = origin.y; pos[i * 3 + 2] = origin.z;
      b.vels[i * 3] = rng.range(-spread, spread);
      b.vels[i * 3 + 1] = rng.range(up * 0.4, up);
      b.vels[i * 3 + 2] = rng.range(-spread, spread);
    }
    b.points.geometry.attributes.position.needsUpdate = true;
    b.points.visible = true;
    b.life = 0;
    b.maxLife = 0.8;
    b.kind = kind;
    bursts.push(b);
  }

  // --- dizzy stars over a crashed dude (spec §7.1) ---
  const starGroup = new THREE.Group();
  starGroup.visible = false;
  const starMat = new THREE.MeshBasicMaterial({ color: 0xffd75e });
  for (let i = 0; i < 4; i++) {
    const star = new THREE.Mesh(new THREE.CircleGeometry(0.09, 5), starMat);
    star.userData.ph = (i / 4) * TAU;
    starGroup.add(star);
  }
  worldGroup.add(starGroup);
  let starT = 0;

  // --- ambience fleets ---
  const leafMat = new THREE.MeshBasicMaterial({ color: 0xd9a53d, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
  const butterflyMats = [0xe8823c, 0x8f6fd8, 0xf5f2e3].map(
    (c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })
  );
  const pollenMat = new THREE.PointsMaterial({ color: 0xfff4c8, size: 0.09, transparent: true, opacity: 0.7, depthWrite: false });

  const butterflies = [];
  for (let i = 0; i < 7; i++) {
    const b = new THREE.Group();
    const mat = butterflyMats[i % butterflyMats.length];
    const wingGeo = new THREE.PlaneGeometry(0.14, 0.11);
    const w1 = new THREE.Mesh(wingGeo, mat);
    const w2 = new THREE.Mesh(wingGeo, mat);
    w1.position.x = -0.07; w2.position.x = 0.07;
    b.add(w1, w2);
    b.userData = { w1, w2, ph: rng.range(0, TAU), ds: rng.range(6, 40), dl: rng.range(-5, 5), h: rng.range(0.5, 2.2) };
    b.visible = false;
    worldGroup.add(b);
    butterflies.push(b);
  }

  const leaves = [];
  for (let i = 0; i < 22; i++) {
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.1), leafMat);
    leaf.userData = { ph: rng.range(0, TAU), ds: rng.range(2, 45), dl: rng.range(-7, 7), h: rng.range(1, 7), fall: rng.range(0.25, 0.6) };
    leaf.visible = false;
    worldGroup.add(leaf);
    leaves.push(leaf);
  }

  const pollenCount = 50;
  const pollenGeo = new THREE.BufferGeometry();
  pollenGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pollenCount * 3), 3));
  const pollen = new THREE.Points(pollenGeo, pollenMat);
  pollen.frustumCulled = false;
  worldGroup.add(pollen);
  const pollenData = Array.from({ length: pollenCount }, () => ({
    ds: rng.range(2, 40), dl: rng.range(-8, 8), h: rng.range(0.3, 5), ph: rng.range(0, TAU),
  }));

  let t = 0;

  function update(dt, playerS, phaseMix) {
    t += dt;
    // bursts
    for (let i = bursts.length - 1; i >= 0; i--) {
      const b = bursts[i];
      b.life += dt;
      const pos = b.points.geometry.attributes.position.array;
      for (let p = 0; p < b.count; p++) {
        pos[p * 3] += b.vels[p * 3] * dt;
        pos[p * 3 + 1] += b.vels[p * 3 + 1] * dt;
        pos[p * 3 + 2] += b.vels[p * 3 + 2] * dt;
        b.vels[p * 3 + 1] -= 6 * dt;
      }
      b.points.geometry.attributes.position.needsUpdate = true;
      b.points.material.opacity = 0.9 * (1 - b.life / b.maxLife);
      if (b.life >= b.maxLife) {
        b.points.visible = false;
        bursts.splice(i, 1);
        burstPools[b.kind].push(b);
      }
    }

    // stars
    if (starGroup.visible) {
      starT += dt;
      starGroup.children.forEach((star) => {
        const a = starT * 3 + star.userData.ph;
        star.position.set(Math.cos(a) * 0.4, 0.15 + Math.sin(starT * 6 + star.userData.ph) * 0.05, Math.sin(a) * 0.4);
        star.rotation.z += dt * 4;
      });
    }

    // butterflies: cozy in phases 1-3, fade out in chaos
    const butterflyOn = phaseMix < 2.4;
    butterflies.forEach((b, i) => {
      b.visible = butterflyOn;
      if (!butterflyOn) return;
      const u = b.userData;
      u.ds -= dt * 1.2; // flutter slowly up-trail relative to world
      if (playerS + u.ds < playerS - 4) u.ds = rng.range(25, 45);
      const s = playerS + u.ds;
      const flap = Math.sin(t * 16 + u.ph) * 1.1;
      u.w1.rotation.y = flap;
      u.w2.rotation.y = -flap;
      b.position.copy(trackPos(s, u.dl + Math.sin(t * 0.7 + u.ph) * 1.5, u.h + Math.sin(t * 2.1 + u.ph) * 0.3));
      b.rotation.y = Math.sin(t * 0.4 + u.ph);
    });

    // golden leaves in phase 4
    const leavesOn = phaseMix > 2.5;
    leaves.forEach((leaf) => {
      leaf.visible = leavesOn;
      if (!leavesOn) return;
      const u = leaf.userData;
      u.h -= u.fall * dt;
      u.dl += Math.sin(t * 1.3 + u.ph) * dt * 0.8;
      if (u.h < 0) { u.h = rng.range(4, 8); u.ds = rng.range(2, 45); u.dl = rng.range(-7, 7); }
      leaf.position.copy(trackPos(playerS + u.ds, u.dl, u.h));
      leaf.rotation.set(Math.sin(t * 2 + u.ph) * 1.2, t * 0.8 + u.ph, Math.sin(t * 1.4 + u.ph));
    });

    // pollen motes in the god-ray forest
    const pollenStrength = clamp(1 - Math.abs(phaseMix - 1) * 1.3, 0, 1);
    pollen.visible = pollenStrength > 0.1;
    if (pollen.visible) {
      pollenMat.opacity = 0.55 * pollenStrength;
      const arr = pollenGeo.attributes.position.array;
      pollenData.forEach((u, i) => {
        const p = trackPos(playerS + u.ds, u.dl + Math.sin(t * 0.5 + u.ph), u.h + Math.sin(t * 0.35 + u.ph) * 0.6);
        arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
        u.ds -= dt * 0.4;
        if (u.ds < -4) u.ds = rng.range(20, 40);
      });
      pollenGeo.attributes.position.needsUpdate = true;
    }
  }

  return {
    update,
    dustPuff: (s, l) => burst('dust', s, l, 0.25, 2.8, 3),
    mudSplash: (s, l) => burst('mud', s, l, 0.15, 1.6, 2.2),
    waterSplash: (s, l) => burst('water', s, l, 0.2, 2, 3),
    landPuff: (s, l) => burst('dust', s, l, 0.1, 1.4, 1.2),
    showStars(pos) { starGroup.visible = true; starGroup.position.copy(pos).add(new THREE.Vector3(0, 0.5, 0)); starT = 0; },
    hideStars() { starGroup.visible = false; },
  };
}
