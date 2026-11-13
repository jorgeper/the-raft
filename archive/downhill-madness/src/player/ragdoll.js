import * as THREE from 'three';

// Spectacular crash physics (spec §7.1): a Verlet particle ragdoll with
// distance constraints. Limbs stay jointed, the backpack flies free,
// everything bounces down the slope. Emergent — no canned animation.

const ITERATIONS = 5;
const SUBSTEPS = 3;
const GRAVITY = 25;

function particle(pos, radius = 0.09) {
  return { pos: pos.clone(), prev: pos.clone(), radius };
}

function constraint(a, b, stiffness = 1) {
  return { a, b, rest: a.pos.distanceTo(b.pos), stiffness };
}

const _v = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _m = new THREE.Matrix4();

export function createRagdoll(character, { groundHeightAt, nearbyBoxesWorld }) {
  let parts = null; // { particles, constraints, pieces, freeBodies }
  let active = false;
  let settledTime = 0;

  function worldPosOf(obj) {
    return obj.getWorldPosition(new THREE.Vector3());
  }

  function activate(velocity, ragGroup, worldOffset) {
    active = true;
    settledTime = 0;
    const c = character;

    // scene -> track-world conversion: ragGroup lives inside the shifted
    // world group, so subtract its offset from scene-space joint positions
    const toTrack = (v) => v.sub(worldOffset);

    // key joint world positions before we tear the hierarchy apart
    const wNeck = worldPosOf(c.joints.neck);
    const wHead = wNeck.clone().add(new THREE.Vector3(0, 0.24, 0));
    const wHips = worldPosOf(c.hips);
    const wShL = worldPosOf(c.armL.shoulder);
    const wShR = worldPosOf(c.armR.shoulder);
    const wElL = worldPosOf(c.armL.elbow);
    const wElR = worldPosOf(c.armR.elbow);
    const wHaL = wElL.clone().add(new THREE.Vector3(0, -0.3, 0));
    const wHaR = wElR.clone().add(new THREE.Vector3(0, -0.3, 0));
    const wKnL = worldPosOf(c.legL.knee);
    const wKnR = worldPosOf(c.legR.knee);
    const wFtL = wKnL.clone().add(new THREE.Vector3(0, -0.42, 0.05));
    const wFtR = wKnR.clone().add(new THREE.Vector3(0, -0.42, 0.05));
    const wPack = worldPosOf(c.pack);
    for (const w of [wNeck, wHead, wHips, wShL, wShR, wElL, wElR, wHaL, wHaR, wKnL, wKnR, wFtL, wFtR, wPack]) toTrack(w);

    const P = {
      head: particle(wHead, 0.15),
      neck: particle(wNeck, 0.12),
      hips: particle(wHips, 0.15),
      shL: particle(wShL, 0.09), shR: particle(wShR, 0.09),
      elL: particle(wElL, 0.07), elR: particle(wElR, 0.07),
      haL: particle(wHaL, 0.06), haR: particle(wHaR, 0.06),
      knL: particle(wKnL, 0.08), knR: particle(wKnR, 0.08),
      ftL: particle(wFtL, 0.08), ftR: particle(wFtR, 0.08),
    };

    const C = [
      constraint(P.head, P.neck),
      constraint(P.neck, P.hips),
      constraint(P.shL, P.neck), constraint(P.shR, P.neck),
      constraint(P.shL, P.shR),
      constraint(P.shL, P.hips, 0.9), constraint(P.shR, P.hips, 0.9),
      constraint(P.shL, P.elL), constraint(P.elL, P.haL),
      constraint(P.shR, P.elR), constraint(P.elR, P.haR),
      constraint(P.hips, P.knL), constraint(P.knL, P.ftL),
      constraint(P.hips, P.knR), constraint(P.knR, P.ftR),
      constraint(P.head, P.hips, 0.3), // gentle brace: no full backfold
    ];

    // launch with run momentum + a comedic pop; per-particle variation
    // makes him tumble instead of gliding
    const dt0 = 1 / 60;
    let seedI = 0;
    for (const key of Object.keys(P)) {
      const p = P[key];
      const jx = Math.sin(seedI * 12.9898 + velocity.x * 78.233) * 1.6;
      const jy = Math.sin(seedI * 39.425 + velocity.z * 12.9) * 1.3;
      const v = velocity.clone().add(new THREE.Vector3(jx, 2.2 + Math.abs(jy), jy * 0.7));
      p.prev.copy(p.pos).addScaledVector(v, -dt0);
      seedI++;
    }
    // feet trip: bottom half whips forward extra
    for (const key of ['ftL', 'ftR', 'knL', 'knR']) {
      P[key].prev.addScaledVector(velocity, -dt0 * 0.8);
    }

    // the backpack becomes a free body that flies off (no hat anymore)
    const free = [];
    for (const [obj, w, spin] of [[c.pack, wPack, 7]]) {
      ragGroup.attach(obj);
      free.push({
        obj,
        p: particle(w, 0.14),
        angVel: new THREE.Vector3(Math.sin(spin) * 9, spin, Math.cos(spin) * 8),
      });
      const v = velocity.clone().multiplyScalar(1.25).add(new THREE.Vector3(Math.sin(spin) * 2.5, 4.5, 1));
      free[free.length - 1].p.prev.copy(w).addScaledVector(v, -dt0);
    }

    // reparent body pieces flat into the ragdoll group (keeps world transform)
    const pieces = [];
    const attachPiece = (obj, a, b, flip = false) => {
      ragGroup.attach(obj);
      pieces.push({ obj, a, b, flip, offset: null });
    };
    attachPiece(c.joints.neck, P.neck, P.head); // head + face + hair
    attachPiece(c.armL.shoulder, P.shL, P.elL, true);
    attachPiece(c.armR.shoulder, P.shR, P.elR, true);
    attachPiece(c.armL.elbow, P.elL, P.haL, true);
    attachPiece(c.armR.elbow, P.elR, P.haR, true);
    attachPiece(c.legL.hip, P.hips, P.knL, true);
    attachPiece(c.legR.hip, P.hips, P.knR, true);
    attachPiece(c.legL.knee, P.knL, P.ftL, true);
    attachPiece(c.legR.knee, P.knR, P.ftR, true);
    // torso pieces use the shoulder axis for roll
    ragGroup.attach(c.torso);
    ragGroup.attach(c.hips);

    parts = { P, C, pieces, free, torso: c.torso, hipsObj: c.hips };
  }

  function collide(p) {
    // ground
    const gy = groundHeightAt(p.pos.x, p.pos.z) + p.radius;
    if (p.pos.y < gy) {
      const vy = p.pos.y - p.prev.y;
      p.pos.y = gy;
      p.prev.y = p.pos.y + vy * 0.38; // restitution
      // friction on the tangent plane
      p.prev.x = p.pos.x - (p.pos.x - p.prev.x) * 0.62;
      p.prev.z = p.pos.z - (p.pos.z - p.prev.z) * 0.62;
    }
    // obstacle boxes (world-space AABBs)
    for (const b of nearbyBoxesWorld()) {
      if (
        p.pos.x > b.min.x - p.radius && p.pos.x < b.max.x + p.radius &&
        p.pos.y > b.min.y - p.radius && p.pos.y < b.max.y + p.radius &&
        p.pos.z > b.min.z - p.radius && p.pos.z < b.max.z + p.radius
      ) {
        // push out along the smallest penetration axis
        const dxMin = p.pos.x - (b.min.x - p.radius), dxMax = (b.max.x + p.radius) - p.pos.x;
        const dyMin = p.pos.y - (b.min.y - p.radius), dyMax = (b.max.y + p.radius) - p.pos.y;
        const dzMin = p.pos.z - (b.min.z - p.radius), dzMax = (b.max.z + p.radius) - p.pos.z;
        const m = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
        if (m === dxMin) p.pos.x = b.min.x - p.radius;
        else if (m === dxMax) p.pos.x = b.max.x + p.radius;
        else if (m === dyMin) p.pos.y = b.min.y - p.radius;
        else if (m === dyMax) { p.pos.y = b.max.y + p.radius; p.prev.y = p.pos.y + (p.pos.y - p.prev.y) * 0.3; }
        else if (m === dzMin) p.pos.z = b.min.z - p.radius;
        else p.pos.z = b.max.z + p.radius;
      }
    }
  }

  function update(dt) {
    if (!active || !parts) return;
    const h = dt / SUBSTEPS;
    let motion = 0;
    for (let step = 0; step < SUBSTEPS; step++) {
      for (const key of Object.keys(parts.P)) {
        const p = parts.P[key];
        _v.subVectors(p.pos, p.prev).multiplyScalar(0.995);
        motion += _v.lengthSq();
        p.prev.copy(p.pos);
        p.pos.add(_v);
        p.pos.y -= GRAVITY * h * h;
        collide(p);
      }
      for (let i = 0; i < ITERATIONS; i++) {
        for (const c of parts.C) {
          _v.subVectors(c.b.pos, c.a.pos);
          const d = _v.length() || 1e-6;
          const diff = ((d - c.rest) / d) * 0.5 * c.stiffness;
          c.a.pos.addScaledVector(_v, diff);
          c.b.pos.addScaledVector(_v, -diff);
        }
      }
      for (const f of parts.free) {
        const p = f.p;
        _v.subVectors(p.pos, p.prev).multiplyScalar(0.992);
        p.prev.copy(p.pos);
        p.pos.add(_v);
        p.pos.y -= GRAVITY * h * h * 0.7; // light free bodies float a little
        collide(p);
        f.angVel.multiplyScalar(0.985);
      }
    }
    if (motion < 0.00003) settledTime += dt; else settledTime = 0;
    syncMeshes(dt);
  }

  function orientPiece(obj, a, b, flip) {
    _up.subVectors(b.pos, a.pos).normalize();
    if (flip) _up.negate();
    // build a stable basis around the segment axis
    _fwd.set(0, 0, -1);
    if (Math.abs(_up.dot(_fwd)) > 0.93) _fwd.set(1, 0, 0);
    _right.crossVectors(_up, _fwd).normalize();
    _fwd.crossVectors(_right, _up).normalize();
    _m.makeBasis(_right, _up, _fwd);
    obj.quaternion.setFromRotationMatrix(_m);
    obj.position.copy(a.pos);
  }

  function syncMeshes(dt) {
    const { P, pieces, torso, hipsObj, free } = parts;
    for (const pc of pieces) orientPiece(pc.obj, pc.a, pc.b, pc.flip);

    // torso: basis from spine + shoulder axis
    _up.subVectors(P.neck.pos, P.hips.pos).normalize();
    _right.subVectors(P.shR.pos, P.shL.pos).normalize();
    _fwd.crossVectors(_right, _up).normalize();
    _right.crossVectors(_up, _fwd).normalize();
    _m.makeBasis(_right, _up, _fwd);
    torso.quaternion.setFromRotationMatrix(_m);
    torso.position.copy(P.hips.pos).lerp(P.neck.pos, 0.15);
    hipsObj.quaternion.copy(torso.quaternion);
    hipsObj.position.copy(P.hips.pos);

    for (const f of free) {
      f.obj.position.copy(f.p.pos);
      f.obj.rotation.x += f.angVel.x * dt;
      f.obj.rotation.y += f.angVel.y * dt;
      f.obj.rotation.z += f.angVel.z * dt;
    }
  }

  return {
    activate,
    update,
    isActive: () => active,
    isSettled: () => settledTime > 0.5,
    headPos: () => (parts ? parts.P.head.pos : null),
    hipsPos: () => (parts ? parts.P.hips.pos : null),
    deactivate() { active = false; parts = null; },
  };
}
