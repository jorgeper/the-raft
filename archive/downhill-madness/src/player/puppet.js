import * as THREE from 'three';
import { clamp, TAU } from '../utils/math.js';

// Physics-driven runner (spec §7.1): the same Verlet-particle skeleton the
// crash ragdoll uses, simulated LIVE in the player's local frame. Motor
// impulses puppet the legs/torso through a sprint cycle; the arms are
// near-free bodies that windmill and whip out of control. Steering, jumps
// and landings inject inertial pseudo-forces, so all the flailing is real
// physics, not animation. He must never look calm.

const SUBSTEPS = 3;
const ITERATIONS = 5;
const GRAVITY = 14; // gentler than world gravity: he is (barely) holding himself up

function particle(x, y, z, radius = 0.08) {
  return {
    pos: new THREE.Vector3(x, y, z),
    prev: new THREE.Vector3(x, y, z),
    force: new THREE.Vector3(),
    radius,
  };
}

const constraint = (a, b, stiffness = 1) => ({ a, b, rest: a.pos.distanceTo(b.pos), stiffness });

const _v = new THREE.Vector3();
const _t = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _m = new THREE.Matrix4();

export function createPuppet(character) {
  // rest-pose skeleton in root-local space (forward = -z)
  const P = {
    hips: particle(0, 0.92, 0, 0.14),
    neck: particle(0, 1.54, 0, 0.11),
    head: particle(0, 1.78, 0, 0.14),
    shL: particle(-0.26, 1.44, 0), shR: particle(0.26, 1.44, 0),
    elL: particle(-0.32, 1.14, 0), elR: particle(0.32, 1.14, 0),
    haL: particle(-0.34, 0.84, 0, 0.06), haR: particle(0.34, 0.84, 0, 0.06),
    knL: particle(-0.11, 0.42, 0), knR: particle(0.11, 0.42, 0),
    ftL: particle(-0.11, 0.0, 0, 0.07), ftR: particle(0.11, 0.0, 0, 0.07),
  };
  const C = [
    constraint(P.head, P.neck),
    constraint(P.neck, P.hips),
    constraint(P.shL, P.neck), constraint(P.shR, P.neck),
    constraint(P.shL, P.shR),
    constraint(P.shL, P.hips, 0.85), constraint(P.shR, P.hips, 0.85),
    constraint(P.shL, P.elL), constraint(P.elL, P.haL),
    constraint(P.shR, P.elR), constraint(P.elR, P.haR),
    constraint(P.hips, P.knL), constraint(P.knL, P.ftL),
    constraint(P.hips, P.knR), constraint(P.knR, P.ftR),
    constraint(P.head, P.hips, 0.25),
  ];

  // motor strengths (spring accel per meter of error): how hard each particle
  // is dragged to its gait target. Legs/hips strong (he does keep running),
  // head bobbly, arms nearly free — that's where the comedy lives.
  const MOTOR = {
    hips: 900, neck: 420, head: 150,
    shL: 260, shR: 260,
    elL: 5, elR: 5, haL: 2.5, haR: 2.5,
    knL: 500, knR: 500, ftL: 1200, ftR: 1200,
  };

  let phase = 0;
  let t = 0;
  let prevVl = 0, prevVy = 0;
  let windmillDir = 1, windmillTimer = 0;
  const targets = {};
  for (const k of Object.keys(P)) targets[k] = new THREE.Vector3().copy(P[k].pos);

  function gaitTargets(state) {
    const { speed, steer, grounded, vy } = state;
    const desp = clamp((speed - 9) / 20, 0, 1); // desperation 0..1
    const stride = clamp(0.3 + speed * 0.02, 0.3, 0.62);
    const lift = 0.22 + desp * 0.2;
    const leanX = steer * (0.12 + desp * 0.1);
    const pitch = 0.1 + desp * 0.34; // forward pitch: barely ahead of his own fall

    const sin = Math.sin(phase), cos = Math.cos(phase);

    if (grounded) {
      targets.ftL.set(-0.12 + leanX * 0.4, Math.max(0, sin) * lift, -cos * stride);
      targets.ftR.set(0.12 + leanX * 0.4, Math.max(0, -sin) * lift, cos * stride);
    } else if (vy > 2) { // rising: tuck
      targets.ftL.set(-0.14, 0.5, -0.25);
      targets.ftR.set(0.14, 0.42, -0.3);
    } else { // apex/falling: legs reach and pedal in panic
      const f = Math.sin(t * 17);
      targets.ftL.set(-0.16, 0.25 + f * 0.15, -0.3 - f * 0.2);
      targets.ftR.set(0.16, 0.25 - f * 0.15, -0.1 + f * 0.2);
    }
    targets.knL.copy(targets.ftL).multiplyScalar(0.45).add(_t.set(-0.02 + leanX * 0.2, 0.5, -0.16));
    targets.knR.copy(targets.ftR).multiplyScalar(0.45).add(_t.set(0.02 + leanX * 0.2, 0.5, -0.16));

    const bounce = grounded ? Math.abs(sin) * (0.05 + desp * 0.05) : 0;
    targets.hips.set(leanX * 0.5, 0.92 + bounce, 0);
    targets.neck.set(leanX * 0.9, 1.52 - pitch * 0.22 + bounce, -pitch * 0.42);
    targets.head.set(leanX * 1.1, targets.neck.y + 0.24, targets.neck.z - 0.05 - desp * 0.08);

    const twist = Math.sin(phase) * (0.12 + desp * 0.1);
    targets.shL.set(-0.26 + leanX * 0.9, targets.neck.y - 0.09, targets.neck.z - twist);
    targets.shR.set(0.26 + leanX * 0.9, targets.neck.y - 0.09, targets.neck.z + twist);

    // arms: token targets only — the motors are so weak these barely matter
    targets.elL.set(-0.5, 1.2, -0.15);
    targets.elR.set(0.5, 1.2, -0.15);
    targets.haL.set(-0.55, 1.1, -0.35);
    targets.haR.set(0.55, 1.1, -0.35);
    return desp;
  }

  function applyComedyForces(state, desp, h) {
    const { grounded, spinning } = state;
    // windmilling: continuous tangential force circling each hand around its
    // shoulder — direction flips every few seconds for variety
    windmillTimer -= h;
    if (windmillTimer <= 0) { windmillDir *= -1; windmillTimer = 1.6 + Math.abs(Math.sin(t * 3.7)) * 2.4; }
    const wind = 70 + desp * 300 + (spinning ? 160 : 0) + (!grounded ? 110 : 0);
    for (const [hand, sh, dir] of [[P.haL, P.shL, 1], [P.haR, P.shR, -1]]) {
      _v.subVectors(hand.pos, sh.pos);
      _t.set(0, -_v.z, _v.y).normalize(); // tangent in the sagittal plane
      hand.force.addScaledVector(_t, wind * windmillDir * dir);
    }
    // chaotic turbulence on hands, elbows and head
    const amp = 16 + desp * 60 + (!grounded ? 30 : 0);
    P.haL.force.x += Math.sin(t * 13.1) * amp;
    P.haL.force.z += Math.sin(t * 17.7 + 2) * amp * 0.7;
    P.haR.force.x += Math.sin(t * 14.3 + 4) * amp;
    P.haR.force.z += Math.sin(t * 16.1 + 1) * amp * 0.7;
    P.elL.force.y += Math.sin(t * 11.3 + 3) * amp * 0.5;
    P.elR.force.y += Math.sin(t * 12.9 + 5) * amp * 0.5;
    P.head.force.x += Math.sin(t * 9.7) * desp * 7;
    // sprint drag: arms and head trail backward as speed builds
    const drag = 2 + desp * 11;
    for (const p of [P.haL, P.haR, P.elL, P.elR]) p.force.z += drag;
    P.head.force.z += drag * 0.25;
  }

  function update(dt, state) {
    t += dt;
    const { speed, grounded, stumbling } = state;
    const strideFreq = clamp(1.7 + speed * 0.115, 2, 5.4);
    if (grounded) phase += strideFreq * TAU * dt;

    const desp = gaitTargets(state);

    // inertial pseudo-forces: the frame accelerates, the body objects
    const vl = state.lateralVel ?? 0;
    const vy = state.vy ?? 0;
    const al = clamp((vl - prevVl) / dt, -60, 60);
    const ay = grounded ? 0 : clamp((vy - prevVy) / dt, -50, 50);
    prevVl = vl; prevVy = vy;

    const motorScale = stumbling ? 0.35 : 1; // stumble: strings go slack, chaos doubles

    const h = dt / SUBSTEPS;
    for (let step = 0; step < SUBSTEPS; step++) {
      applyComedyForces(state, desp, h);
      if (stumbling) {
        P.haL.force.x += Math.sin(t * 31) * 90;
        P.haR.force.x -= Math.sin(t * 29) * 90;
      }
      for (const key of Object.keys(P)) {
        const p = P[key];
        const looseness = MOTOR[key] < 10 ? 1 : MOTOR[key] < 300 ? 0.45 : 0.12;
        p.force.x -= al * looseness * 1.1;
        p.force.y -= ay * looseness * 0.5;
        // motor: spring impulse toward the gait target
        _t.subVectors(targets[key], p.pos).multiplyScalar(MOTOR[key] * motorScale);
        p.force.add(_t);
        _v.subVectors(p.pos, p.prev).multiplyScalar(0.985); // damping
        p.prev.copy(p.pos);
        p.pos.add(_v);
        p.pos.y -= GRAVITY * h * h;
        p.pos.addScaledVector(p.force, h * h);
        p.force.set(0, 0, 0);
        // floor: never below the ground plane under the root
        const floor = -(state.footY ?? 0) + p.radius - 0.06;
        if (p.pos.y < floor) p.pos.y = floor;
        // sanity box so nothing explodes
        p.pos.x = clamp(p.pos.x, -1.6, 1.6);
        p.pos.z = clamp(p.pos.z, -1.6, 1.6);
        p.pos.y = clamp(p.pos.y, -1.5, 3);
      }
      for (let i = 0; i < ITERATIONS; i++) {
        for (const c of C) {
          _v.subVectors(c.b.pos, c.a.pos);
          const d = _v.length() || 1e-6;
          const diff = ((d - c.rest) / d) * 0.5 * c.stiffness;
          c.a.pos.addScaledVector(_v, diff);
          c.b.pos.addScaledVector(_v, -diff);
        }
      }
    }
    syncMeshes();
  }

  function orientPiece(obj, a, b) {
    _up.subVectors(a.pos, b.pos).normalize(); // pieces hang -Y from their pivot
    _fwd.set(0, 0, -1);
    if (Math.abs(_up.dot(_fwd)) > 0.93) _fwd.set(1, 0, 0);
    _right.crossVectors(_up, _fwd).normalize();
    _fwd.crossVectors(_right, _up).normalize();
    _m.makeBasis(_right, _up, _fwd);
    obj.quaternion.setFromRotationMatrix(_m);
    obj.position.copy(a.pos);
  }

  function syncMeshes() {
    const c = character;
    orientPiece(c.armL.shoulder, P.shL, P.elL);
    orientPiece(c.armR.shoulder, P.shR, P.elR);
    orientPiece(c.armL.elbow, P.elL, P.haL);
    orientPiece(c.armR.elbow, P.elR, P.haR);
    orientPiece(c.legL.hip, P.hips, P.knL);
    c.legL.hip.position.set(P.hips.pos.x - 0.11, P.hips.pos.y - 0.06, P.hips.pos.z);
    orientPiece(c.legR.hip, P.hips, P.knR);
    c.legR.hip.position.set(P.hips.pos.x + 0.11, P.hips.pos.y - 0.06, P.hips.pos.z);
    orientPiece(c.legL.knee, P.knL, P.ftL);
    orientPiece(c.legR.knee, P.knR, P.ftR);

    // torso basis from spine + shoulder axis
    _up.subVectors(P.neck.pos, P.hips.pos).normalize();
    _right.subVectors(P.shR.pos, P.shL.pos).normalize();
    _fwd.crossVectors(_right, _up).normalize();
    _right.crossVectors(_up, _fwd).normalize();
    _m.makeBasis(_right, _up, _fwd);
    c.torso.quaternion.setFromRotationMatrix(_m);
    c.torso.position.copy(P.hips.pos).lerp(P.neck.pos, 0.18);
    c.hips.quaternion.copy(c.torso.quaternion);
    c.hips.position.copy(P.hips.pos);

    // head piece: from neck toward head particle
    _up.subVectors(P.head.pos, P.neck.pos).normalize();
    _fwd.set(0, 0, -1);
    _right.crossVectors(_up, _fwd).normalize();
    _fwd.crossVectors(_right, _up).normalize();
    _m.makeBasis(_right, _up, _fwd);
    c.joints.neck.quaternion.setFromRotationMatrix(_m);
    c.joints.neck.position.copy(P.neck.pos);

    // backpack piece rides the torso with its own lag baked by physics feel
    c.pack.position.copy(c.torso.position).addScaledVector(_fwd, -0.24).add(_t.set(0, 0.18, 0));
    c.pack.quaternion.copy(c.torso.quaternion);
  }

  function jolt(amount = 6) {
    for (const key of ['haL', 'haR', 'elL', 'elR', 'head']) {
      const p = P[key];
      p.prev.x += Math.sin(amount * 17 + p.pos.y * 31) * 0.02 * amount;
      p.prev.y -= 0.015 * amount;
    }
  }

  return { update, jolt, particles: P };
}
