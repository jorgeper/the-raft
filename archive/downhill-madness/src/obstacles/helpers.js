import * as THREE from 'three';
import { centerX, groundY } from '../world/trail.js';

// Shared builders for adorable articulated-low-poly critters & folks (spec §7).

export const trackPos = (s, l, y = 0) => new THREE.Vector3(centerX(s) + l, groundY(s) + y, -s);
export const setOnTrail = (obj, s, l, y = 0) => obj.position.set(centerX(s) + l, groundY(s) + y, -s);

export function flatMat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, flatShading: true, ...extra });
}

export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

export function holsteinTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2ede2';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#3a3230';
  for (const [x, y, r] of [[10, 12, 11], [42, 8, 9], [28, 38, 13], [56, 44, 10], [6, 50, 8]]) {
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.75, 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Generic quadruped: body, head w/ ears, 4 leg pivots, tail. Round faces,
// cute > realistic, always.
export function buildQuadruped({
  bodyW = 0.5, bodyH = 0.5, bodyL = 0.8, legH = 0.35, headSize = 0.3,
  bodyMat, headMat, legMat, earMat, fluffy = false,
}) {
  const g = new THREE.Group();
  const body = box(bodyW, bodyH, bodyL, bodyMat, 0, legH + bodyH / 2, 0);
  if (fluffy) {
    // woolly lumps on top
    for (const [x, y, z, s] of [[-0.12, 0.22, -0.2, 0.5], [0.14, 0.24, 0.05, 0.55], [-0.05, 0.22, 0.25, 0.5]]) {
      const lump = box(bodyW * s, bodyH * 0.4, bodyL * 0.35, bodyMat, x * bodyW, y + bodyH / 2, z * bodyL);
      body.add(lump);
    }
  }
  g.add(body);

  const headPivot = new THREE.Group();
  headPivot.position.set(0, legH + bodyH * 0.82, -bodyL / 2 - headSize * 0.15);
  const head = box(headSize, headSize * 0.9, headSize, headMat, 0, headSize * 0.2, -headSize * 0.35);
  // snout + eyes
  head.add(box(headSize * 0.5, headSize * 0.4, headSize * 0.35, headMat, 0, -headSize * 0.18, -headSize * 0.55));
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x241d16 });
  const e1 = box(headSize * 0.12, headSize * 0.16, 0.02, eyeMat, -headSize * 0.26, headSize * 0.12, -headSize * 0.51);
  const e2 = box(headSize * 0.12, headSize * 0.16, 0.02, eyeMat, headSize * 0.26, headSize * 0.12, -headSize * 0.51);
  e1.castShadow = e2.castShadow = false;
  head.add(e1, e2);
  const ear1 = box(headSize * 0.28, headSize * 0.34, 0.05, earMat || headMat, -headSize * 0.5, headSize * 0.5, 0);
  const ear2 = box(headSize * 0.28, headSize * 0.34, 0.05, earMat || headMat, headSize * 0.5, headSize * 0.5, 0);
  ear1.rotation.z = 0.35; ear2.rotation.z = -0.35;
  head.add(ear1, ear2);
  headPivot.add(head);
  g.add(headPivot);

  const legs = [];
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x * (bodyW / 2 - 0.06), legH, z * (bodyL / 2 - 0.09));
    pivot.add(box(0.1, legH, 0.11, legMat, 0, -legH / 2, 0));
    g.add(pivot);
    legs.push(pivot);
  }

  const tail = new THREE.Group();
  tail.position.set(0, legH + bodyH * 0.8, bodyL / 2);
  tail.add(box(0.07, 0.28, 0.07, legMat, 0, -0.1, 0.03));
  g.add(tail);

  return { group: g, body, headPivot, legs, tail };
}

export function animateWalk(quad, t, amp = 0.5) {
  quad.legs[0].rotation.x = Math.sin(t) * amp;
  quad.legs[1].rotation.x = -Math.sin(t) * amp;
  quad.legs[2].rotation.x = -Math.sin(t) * amp;
  quad.legs[3].rotation.x = Math.sin(t) * amp;
}

// Simplified cheerful person for hikers, rangers, picnickers.
export function buildPerson({ shirt = 0x5a7d3a, pants = 0x6b5b45, skin = 0xe0aa80, hat = null }) {
  const g = new THREE.Group();
  const shirtM = flatMat(shirt), pantsM = flatMat(pants), skinM = flatMat(skin);
  const legL = new THREE.Group(); legL.position.set(-0.09, 0.72, 0);
  legL.add(box(0.12, 0.72, 0.13, pantsM, 0, -0.36, 0));
  const legR = new THREE.Group(); legR.position.set(0.09, 0.72, 0);
  legR.add(box(0.12, 0.72, 0.13, pantsM, 0, -0.36, 0));
  g.add(legL, legR);
  const torso = box(0.36, 0.5, 0.22, shirtM, 0, 1.05, 0);
  g.add(torso);
  const armL = new THREE.Group(); armL.position.set(-0.22, 1.26, 0);
  armL.add(box(0.09, 0.5, 0.1, shirtM, 0, -0.25, 0));
  const armR = new THREE.Group(); armR.position.set(0.22, 1.26, 0);
  armR.add(box(0.09, 0.5, 0.1, shirtM, 0, -0.25, 0));
  g.add(armL, armR);
  const head = box(0.24, 0.26, 0.24, skinM, 0, 1.46, 0);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x241d16 });
  const e1 = box(0.035, 0.05, 0.02, eyeMat, -0.06, 0.03, -0.12);
  const e2 = box(0.035, 0.05, 0.02, eyeMat, 0.06, 0.03, -0.12);
  e1.castShadow = e2.castShadow = false;
  head.add(e1, e2);
  g.add(head);
  if (hat !== null) {
    const hatM = flatMat(hat);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.03, 9), hatM);
    brim.position.y = 1.6;
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.11, 8), hatM);
    crown.position.y = 1.66;
    brim.castShadow = crown.castShadow = true;
    g.add(brim, crown);
  }
  return { group: g, legL, legR, armL, armR, head, torso };
}

// Mossy fallen trunk used by log / logRamp / fallingTree / rollingLog.
export function buildTrunk(length, radius) {
  const g = new THREE.Group();
  const wood = flatMat(0x7a5a3c);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.12, length, 9), wood);
  trunk.rotation.z = Math.PI / 2;
  trunk.castShadow = true;
  g.add(trunk);
  const mossM = flatMat(0x6f9448);
  for (let i = 0; i < 3; i++) {
    const moss = box(length * 0.22, radius * 0.3, radius * 1.3, mossM, (i - 1) * length * 0.3, radius * 0.75, 0);
    moss.castShadow = false;
    g.add(moss);
  }
  const endM = flatMat(0xc9a678);
  for (const side of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.96, 9), endM);
    cap.position.x = side * (length / 2 + 0.01);
    cap.rotation.y = side * -Math.PI / 2;
    g.add(cap);
  }
  return g;
}
