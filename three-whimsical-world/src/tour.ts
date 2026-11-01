import * as THREE from 'three';
import type { WorldFns } from './worldgen';

/**
 * A cinematic flythrough, built from the world itself: in low over the sea at dawn toward the coast, across the
 * beach and skimming the meadow grass, a slow pass around a stone circle (or a giant oak), up over the forest canopy, down the river
 * gorge to a waterfall, then climbing out to look back over the land as the sun sets into the sea. The clock runs
 * with it (fastest through the middle of the day). Positions and aims follow smooth splines at an eased pace, the
 * height is kept clear of the ground ahead (lifting early rather than popping), and the camera banks into turns.
 */

interface Key {
  /** Seconds from the start. */
  t: number;
  pos: THREE.Vector3;
  look: THREE.Vector3;
  /** Time of day at this point. */
  hours: number;
}

const STEP = 0.05;

/** Monotone cubic (Fritsch-Carlson) through (xs, ys): eases between keys without overshooting. */
function monotone(xs: number[], ys: number[]) {
  const n = xs.length;
  const d = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]));
  const m = xs.map((_, i) => (i === 0 || i === n - 1 ? 0 : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      m[i] = k * a * d[i];
      m[i + 1] = k * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], u = (x - xs[i]) / h;
    const u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}

export class Tour {
  active = false;
  /** Seconds into the tour. */
  time = 0;
  readonly duration: number;
  private positions: THREE.Vector3[] = [];
  private looks: THREE.Vector3[] = [];
  private hoursAt: (t: number) => number;
  private quat = new THREE.Quaternion();
  private roll = 0;
  private lastYaw = 0;

  constructor(readonly fns: WorldFns) {
    const keys = this.keys();
    this.duration = keys[keys.length - 1].t;
    // Splines through the keys' positions and aims; the clock maps to the spline's parameter (key i at i / (n - 1))
    // through a monotone cubic, so the pace eases through the keys and comes to rest at both ends.
    const posCurve = new THREE.CatmullRomCurve3(keys.map((k) => k.pos), false, 'centripetal');
    const lookCurve = new THREE.CatmullRomCurve3(keys.map((k) => k.look), false, 'centripetal');
    const param = monotone(keys.map((k) => k.t), keys.map((_, i) => i / (keys.length - 1)));
    this.hoursAt = monotone(keys.map((k) => k.t), keys.map((k) => k.hours));
    // Curve parameters don't map to keys evenly in length (getPoint is by parameter, which is what keeps each key
    // at its time); sample it densely.
    const n = Math.ceil(this.duration / STEP) + 1;
    for (let i = 0; i < n; i++) {
      const u = param(i * STEP);
      this.positions.push(posCurve.getPoint(u));
      this.looks.push(lookCurve.getPoint(u));
    }
    this.clearGround();
  }

  /** Lifts the path clear of the ground, starting the climb ahead of each rise so it never pops. */
  private clearGround() {
    const ground = (p: THREE.Vector3) => Math.max(this.fns.height(p.x, p.z), 0);
    const lift = this.positions.map((p) => Math.max(ground(p) + 2.5 - p.y, 0));
    // Spread each lift over the 1.5 s before and after it, as a smooth bump, then take the largest.
    const reach = Math.round(1.5 / STEP);
    const smoothLift = lift.map((_, i) => {
      let best = 0;
      for (let j = Math.max(0, i - reach); j <= Math.min(lift.length - 1, i + reach); j++) {
        const w = 0.5 + 0.5 * Math.cos((Math.PI * (j - i)) / reach);
        best = Math.max(best, lift[j] * w);
      }
      return best;
    });
    this.positions.forEach((p, i) => (p.y += smoothLift[i]));
  }

  private keys(): Key[] {
    const f = this.fns;
    const ground = (x: number, z: number) => Math.max(f.height(x, z), 0);
    const at = (x: number, up: number, z: number) => new THREE.Vector3(x, ground(x, z) + up, z);
    // The coast: where the land along z = 0 meets the sea, looking out from the meadows.
    let shore = 0;
    for (let x = -100; x < 900; x += 2) {
      if (f.height(x, 0) < -0.4) {
        shore = x;
        break;
      }
    }
    const start = new THREE.Vector3(-30, 0, 0);
    const near = (x: number, z: number) => Math.hypot(x - start.x, z - start.z);
    // The set piece to circle: a stone circle out on open meadow (the nearest to the start), else a giant oak.
    const byNear = (kind: string) => f.landmarks.filter((l) => l.kind === kind && f.forest(l.x, l.z) < 0.3)
      .sort((a, b) => near(a.x, a.z) - near(b.x, b.z))[0];
    const circle = byNear('circle');
    const oak = circle ?? byNear('oak') ?? { x: -200, z: 0, radius: 15 };
    const fall = [...f.waterfalls].sort((a, b) => Math.hypot(a.x - oak.x, a.z - oak.z) - Math.hypot(b.x - oak.x, b.z - oak.z))[0];

    const keys: Key[] = [
      // Dawn over the sea, low over the swell, the sun coming up behind the land ahead.
      { t: 0, pos: new THREE.Vector3(shore + 330, 6, 40), look: new THREE.Vector3(shore - 300, 18, 10), hours: 5.7 },
      { t: 13, pos: new THREE.Vector3(shore + 150, 4, 18), look: new THREE.Vector3(shore - 300, 12, -10), hours: 6.3 },
      // Over the surf and the beach.
      { t: 22, pos: at(shore + 10, 3.5, 6), look: at(oak.x, 10, oak.z), hours: 7.0 },
    ];
    // Skimming the meadow toward the giant oak, the day running on into the afternoon.
    const mid = new THREE.Vector3().lerpVectors(new THREE.Vector3(shore, 0, 0), new THREE.Vector3(oak.x, 0, oak.z), 0.55);
    keys.push({ t: 34, pos: at(mid.x, 2.2, mid.z), look: at(oak.x, 8, oak.z), hours: 15.4 });
    // Around it: from its sea side round to its far side, low among the stones (or looking up into the oak's crown),
    // rising as it goes.
    const toSea = Math.atan2(-oak.z, shore - oak.x);
    const r = circle ? Math.max(oak.radius * 2.6, 22) : Math.max(oak.radius * 3.5, 50);
    for (const [i, da] of [0.35, -0.55, -1.5].entries()) {
      const a = toSea + da;
      keys.push({
        t: 46 + i * 10,
        pos: at(oak.x + Math.cos(a) * r, circle ? 3 + i * 3 : 8 + i * 5, oak.z + Math.sin(a) * r),
        look: at(oak.x, circle ? 1.2 : 11, oak.z),
        hours: 16.2 + i * 0.35,
      });
    }
    if (fall) {
      // The plunge pool and the river it feeds: the gorge runs toward the sea (+x).
      const plungeX = fall.x + fall.dirX * 6, plungeZ = fall.z + fall.dirZ * 6;
      const riverZ = (x: number) => {
        const c = f.riverCenters(x).sort((a, b) => Math.abs(a.z - plungeZ) - Math.abs(b.z - plungeZ))[0];
        return c ? c.z : plungeZ;
      };
      const lookFall = new THREE.Vector3(fall.x, fall.top * 0.55, fall.z);
      const over = new THREE.Vector3().lerpVectors(new THREE.Vector3(oak.x, 0, oak.z), new THREE.Vector3(plungeX + 200, 0, riverZ(plungeX + 200)), 0.5);
      keys.push(
        // Up over the forest canopy.
        { t: 82, pos: at(over.x, 55, over.z), look: at(plungeX, 10, plungeZ), hours: 17.4 },
        // Down into the gorge, following the river upstream to the falls.
        { t: 96, pos: new THREE.Vector3(plungeX + 150, Math.max(fall.top + 18, 30), riverZ(plungeX + 150)), look: lookFall, hours: 17.9 },
        { t: 108, pos: new THREE.Vector3(plungeX + 75, 9, riverZ(plungeX + 75)), look: lookFall, hours: 18.3 },
        { t: 120, pos: new THREE.Vector3(plungeX + 34, 5, riverZ(plungeX + 34)), look: lookFall.clone().setY(fall.top * 0.4), hours: 18.6 },
        // Climbing out of the gorge and turning to the sea as the sun goes down.
        { t: 134, pos: new THREE.Vector3(plungeX + 60, fall.top + 45, riverZ(plungeX + 60) + 25), look: new THREE.Vector3(shore + 400, 20, 0), hours: 19.0 },
        { t: 152, pos: new THREE.Vector3(plungeX + 260, fall.top + 120, riverZ(plungeX + 260) * 0.6), look: new THREE.Vector3(shore + 1500, 0, 0), hours: 19.35 },
      );
    } else {
      keys.push({ t: 90, pos: at(oak.x - 200, 120, oak.z), look: new THREE.Vector3(shore + 1500, 0, 0), hours: 19.35 });
    }
    return keys;
  }

  start() {
    this.active = true;
    this.time = 0;
    this.roll = 0;
    this.lastYaw = NaN;
  }

  stop() {
    this.active = false;
  }

  /** Advances the tour and places `eye`; returns the time of day, or null once it's over. */
  update(dt: number, eye: THREE.Object3D): number | null {
    if (!this.active) return null;
    this.time += dt;
    if (this.time >= this.duration) {
      this.active = false;
      return null;
    }
    const i = Math.min(Math.floor(this.time / STEP), this.positions.length - 2);
    const u = this.time / STEP - i;
    eye.position.lerpVectors(this.positions[i], this.positions[i + 1], u);
    const look = new THREE.Vector3().lerpVectors(this.looks[i], this.looks[i + 1], u);
    const m = new THREE.Matrix4().lookAt(eye.position, look, new THREE.Vector3(0, 1, 0));
    this.quat.setFromRotationMatrix(m);
    // Bank into turns, as a camera on a drone or a bird would.
    const dir = look.clone().sub(eye.position);
    const yaw = Math.atan2(dir.x, dir.z);
    if (Number.isFinite(this.lastYaw) && dt > 0) {
      let dYaw = yaw - this.lastYaw;
      dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
      const target = THREE.MathUtils.clamp(-(dYaw / dt) * 0.35, -0.12, 0.12);
      this.roll += (target - this.roll) * Math.min(dt * 1.5, 1);
    }
    this.lastYaw = yaw;
    eye.quaternion.copy(this.quat).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.roll));
    return this.hoursAt(this.time);
  }
}
