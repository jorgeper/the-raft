import * as THREE from 'three';

// The dude: hatless, flannel-clad, and built as FLAT physics pieces — every
// body segment is an independent group pivoted at its top joint, driven each
// frame by the live Verlet puppet (spec §7.1). The crash ragdoll reuses the
// same pieces, so "crash" is just cutting the strings.

function plaidTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c94f3d';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = 'rgba(60, 30, 40, 0.55)';
  for (let i = 0; i < 64; i += 16) { ctx.fillRect(i, 0, 6, 64); ctx.fillRect(0, i, 64, 6); }
  ctx.fillStyle = 'rgba(255, 220, 150, 0.35)';
  for (let i = 10; i < 64; i += 16) { ctx.fillRect(i, 0, 2, 64); ctx.fillRect(0, i, 64, 2); }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const mat = {
  skin: new THREE.MeshStandardMaterial({ color: 0xe8b08a, roughness: 0.8, flatShading: true }),
  shorts: new THREE.MeshStandardMaterial({ color: 0x8a7a52, roughness: 0.9, flatShading: true }),
  boots: new THREE.MeshStandardMaterial({ color: 0x5a4028, roughness: 0.9, flatShading: true }),
  pack: new THREE.MeshStandardMaterial({ color: 0x3a6ea8, roughness: 0.85, flatShading: true }),
  sock: new THREE.MeshStandardMaterial({ color: 0xe8e0cc, roughness: 0.9, flatShading: true }),
  hair: new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.95, flatShading: true }),
};

function box(w, h, d, material, ox = 0, oy = 0, oz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(ox, oy, oz);
  m.castShadow = true;
  return m;
}

export function buildCharacter() {
  const shirtMat = new THREE.MeshStandardMaterial({ map: plaidTexture(), roughness: 0.9, flatShading: true });

  const root = new THREE.Group(); // world placement (facing, jump height)
  const visual = new THREE.Group(); // spin happens here
  root.add(visual);

  const piece = () => {
    const g = new THREE.Group();
    visual.add(g);
    return g;
  };

  // pelvis: pivot at the hips particle
  const hips = piece();
  hips.add(box(0.34, 0.2, 0.24, mat.shorts, 0, -0.02, 0));

  // torso: pivot near the spine base, chest reaching up toward the neck
  const torso = piece();
  torso.add(box(0.4, 0.52, 0.26, shirtMat, 0, 0.22, 0));

  // head piece (pivot at the neck): head, messy hair, nose, eyes — no hat
  const neck = piece();
  const head = box(0.26, 0.28, 0.26, mat.skin, 0, 0.16, 0);
  const hair = box(0.28, 0.1, 0.28, mat.hair, 0, 0.32, 0.01);
  const tuft = box(0.1, 0.08, 0.1, mat.hair, 0.06, 0.38, 0.03);
  const nose = box(0.06, 0.06, 0.08, mat.skin, 0, 0.14, -0.16);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x2a2118 });
  const eyeL = box(0.035, 0.06, 0.02, eyeMat, -0.07, 0.2, -0.135);
  const eyeR = box(0.035, 0.06, 0.02, eyeMat, 0.07, 0.2, -0.135);
  eyeL.castShadow = eyeR.castShadow = false;
  neck.add(head, hair, tuft, nose, eyeL, eyeR);

  // backpack: its own piece so the ragdoll can send it flying
  const pack = piece();
  pack.add(box(0.3, 0.4, 0.16, mat.pack));
  pack.add(box(0.22, 0.12, 0.14, mat.pack, 0, 0.26, 0));
  pack.add(box(0.05, 0.3, 0.3, mat.pack, -0.12, 0.02, -0.12));
  pack.add(box(0.05, 0.3, 0.3, mat.pack, 0.12, 0.02, -0.12));

  // limb segments: geometry hangs -Y from the joint pivot
  const upperArm = (m) => { const g = piece(); g.add(box(0.11, 0.3, 0.11, m, 0, -0.15, 0)); return g; };
  const lowerArm = () => {
    const g = piece();
    g.add(box(0.09, 0.26, 0.09, mat.skin, 0, -0.13, 0));
    g.add(box(0.1, 0.09, 0.1, mat.skin, 0, -0.29, 0));
    return g;
  };
  const upperLeg = () => { const g = piece(); g.add(box(0.14, 0.4, 0.15, mat.shorts, 0, -0.22, 0)); return g; };
  const lowerLeg = () => {
    const g = piece();
    g.add(box(0.11, 0.34, 0.12, mat.sock, 0, -0.17, 0));
    g.add(box(0.13, 0.1, 0.24, mat.boots, 0, -0.37, -0.05));
    return g;
  };

  const armL = { shoulder: upperArm(shirtMat), elbow: lowerArm() };
  const armR = { shoulder: upperArm(shirtMat), elbow: lowerArm() };
  const legL = { hip: upperLeg(), knee: lowerLeg() };
  const legR = { hip: upperLeg(), knee: lowerLeg() };

  return {
    root, visual, hips, torso, pack,
    armL, armR, legL, legR,
    joints: { neck },
  };
}
