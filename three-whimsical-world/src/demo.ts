import * as THREE from 'three';
import type { WorldFns } from './worldgen';
import type { WeatherKind } from './weather';
import type { Season } from './season';
import { VIBES, type VibeName } from './vibes';

/**
 * Demo mode (J, or `?demo`): a scripted five-minute film of the world, for showing it off or recording it. A run of
 * shots, each with its own camera move, time of day, weather, season, color vibe and lens, joined by fades that hide
 * the jumps: dawn over the sea, the meadow, an 85 mm lens wide open, mist and light shafts in the deep forest,
 * a waterfall's rainbow, the cliffs, a whale off the coast, a passing shower and its rainbow, the
 * four seasons, the vibes, photo mode freezing a wave, sunset and the northern lights. Optional captions name what's
 * on screen. The shots are laid out from the world itself (its coast, landmarks, falls and forests), so they
 * fit any seed. main.ts plays it like the flythrough and puts everything back when it ends.
 */

/** What the demo drives; main.ts implements it. */
export interface DemoHost {
  readonly fns: WorldFns;
  /** Toward the sun, for the time last set. */
  readonly sunDir: THREE.Vector3;
  /** The trees: where they stand and how wide their crowns are. */
  trees(): { x: number; z: number; r: number; broad: boolean }[];
  /** Sets the clock; `relight` re-lights the sky and land (a few times a second is plenty). */
  setTime(hours: number, relight: boolean): void;
  /** `now`: there at once (on a cut); otherwise it rolls in over a few seconds. */
  weather(kind: WeatherKind, now: boolean): void;
  /** `snap`: at once (at a cut); otherwise the land turns over a few seconds. */
  season(season: Season, snap?: boolean): void;
  /** Draws a pond's dragonflies to hover around a point (null: let them roam). */
  dragonflies(at: THREE.Vector3 | null): void;
  vibe(name: VibeName): void;
  /** A lens for the shot, or null for the usual view. */
  lens(lens: { focal: number; fStop: number } | null): void;
  /** Stops the world's clock (waves, wind, rain) while the camera keeps moving. */
  freeze(on: boolean): void;
  /** Northern lights strength (null: the panel's). */
  aurora(strength: number | null): void;
  whale(at: { x: number; z: number }, kind: 'blow' | 'breach'): void;
  /** Whether the waterfalls' spray throws a rainbow. */
  sprayBow(on: boolean): void;
  /** The forest's mood: low fog (strength, height in m), brighter motes (spores and pollen), stronger light shafts. */
  mood(mood: Mood | null): void;
  /** Asks for the next rendered frame, handed back through `Demo.develop`. */
  capture(): void;
  /** After a jump: fill the streamed detail around the new view and drop the old frame's history. */
  cut(): void;
}

export interface Mood {
  fog: number;
  fogHeight: number;
  motes: number;
  light: number;
}

/** Under the trees: mist low between the trunks, spores glittering in the beams. */
const FOREST: Mood = { fog: 0.95, fogHeight: 4.5, motes: 2.6, light: 2.2 };
/** Dusk: thinner mist, so the sky through the trunks keeps its colors. */
const DUSK: Mood = { fog: 0.5, fogHeight: 3, motes: 2.2, light: 1.8 };
const DUSK_OFF = (50 * Math.PI) / 180;

interface Key {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  /** Banking (radians, + rolls right), for fast moves through turns. */
  roll?: number;
}

interface Cue {
  /** Seconds into the shot. */
  at: number;
  /** Dip to black around it (a quick cut on the same move). */
  dip?: boolean;
  run: () => void;
}

interface Shot {
  duration: number;
  /** Time of day at its start and end. */
  hours: [number, number];
  weather?: WeatherKind;
  season?: Season;
  vibe?: VibeName;
  lens?: { focal: number; fStop: number };
  freeze?: boolean;
  viewfinder?: string;
  aurora?: number;
  /** No rainbow in the falls' spray. */
  noSprayBow?: boolean;
  mood?: Mood;
  /** The camera stays this far above the ground (m). */
  clearance?: number;
  fadeIn?: number;
  fadeOut?: number;
  title?: string;
  line?: string;
  /** A title card in the middle of the frame, shown between two times. */
  card?: { title: string; line: string; from: number; to: number };
  /** The camera's keys, evenly spaced in time; built as the shot starts (so it can follow the sun). */
  path: () => Key[];
  cues?: Cue[];
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
/** Half linear, half smoothstep: moving at the cuts, a little ease in between. */
const ease = (x: number) => 0.5 * x + 0.5 * x * x * (3 - 2 * x);

export class Demo {
  active = false;
  captions = true;
  private shots: Shot[] = [];
  private index = 0;
  private t = 0;
  private posCurve!: THREE.CatmullRomCurve3;
  private lookCurve!: THREE.CatmullRomCurve3;
  private rollCurve: THREE.CatmullRomCurve3 | null = null;
  private lift = 0;
  private done = new Set<Cue>();
  private sinceLight = 0;
  private captionAge = 0;
  private pending: { title: string; line: string } | null = null;
  private pendingAge = 0;
  private flashAge = 1e9;
  private printAge = 1e9;
  private readonly el: Record<'fade' | 'caption' | 'title' | 'line' | 'card' | 'cardTitle' | 'cardLine' | 'vf' | 'vfInfo' | 'print' | 'flash', HTMLElement>;
  private readonly img: HTMLImageElement;
  private readonly m = new THREE.Matrix4();
  private readonly up = V(0, 1, 0);

  constructor(private host: DemoHost, stage: HTMLElement) {
    const div = (cls: string, parent: HTMLElement = stage) => {
      const d = document.createElement('div');
      d.className = cls;
      parent.appendChild(d);
      return d;
    };
    const root = div('demo');
    const vf = div('demo-vf', root);
    for (const c of ['tl', 'tr', 'bl', 'br']) div(`demo-corner ${c}`, vf);
    const print = div('demo-print', root);
    this.img = document.createElement('img');
    print.appendChild(this.img);
    const caption = div('demo-caption', root);
    const card = div('demo-card', root);
    this.el = {
      fade: div('demo-fade', root),
      flash: div('demo-flash', root),
      caption,
      title: div('demo-title', caption),
      line: div('demo-line', caption),
      card,
      cardTitle: div('demo-card-title', card),
      cardLine: div('demo-card-line', card),
      vf,
      vfInfo: div('demo-vf-info', vf),
      print,
    };
  }

  /** Total running time (s). */
  get duration() {
    return this.shots.reduce((s, x) => s + x.duration, 0);
  }

  start() {
    this.shots = this.plan();
    this.active = true;
    document.body.classList.add('demo-on');
    this.begin(0);
  }

  stop() {
    this.active = false;
    document.body.classList.remove('demo-on');
    this.el.vf.style.display = 'none';
    this.printAge = 1e9;
    this.el.print.style.opacity = '0';
    this.host.freeze(false);
    this.host.sprayBow(true);
    this.host.mood(null);
    this.host.dragonflies(null);
  }

  /** Jumps to `seconds` into the film (for reviewing a shot), running the cues before it. */
  seek(seconds: number) {
    if (!this.active) return;
    let i = 0;
    while (i < this.shots.length - 1 && seconds >= this.shots[i].duration) seconds -= this.shots[i++].duration;
    this.begin(i);
    this.t = Math.max(seconds - 1e-3, 0);
    for (const cue of this.shots[i].cues ?? []) {
      if (cue.at > this.t) continue;
      this.done.add(cue);
      cue.run();
    }
    this.host.cut();
  }

  /** Where each shot starts (s), for reviewing. */
  get starts() {
    let t = 0;
    return this.shots.map((s) => (t += s.duration) - s.duration);
  }

  /** The frame asked for by `host.capture()`: it develops as a print in the corner. */
  develop(canvas: HTMLCanvasElement) {
    this.img.src = canvas.toDataURL('image/jpeg', 0.85);
    this.flashAge = 0;
    this.printAge = 0;
  }

  /** Changes the caption mid-shot (the old one fades out first). */
  private say(title: string, line: string) {
    this.pending = { title, line };
    this.pendingAge = 0;
  }

  private begin(i: number) {
    const h = this.host;
    const shot = this.shots[i];
    this.index = i;
    this.t = 0;
    this.done.clear();
    this.lift = 0;
    h.setTime(shot.hours[0], true);
    h.weather(shot.weather ?? 'clear', true);
    h.season(shot.season ?? 'summer');
    h.vibe(shot.vibe ?? 'whimsical');
    h.lens(shot.lens ?? null);
    h.freeze(!!shot.freeze);
    h.aurora(shot.aurora ?? null);
    h.sprayBow(!shot.noSprayBow);
    h.mood(shot.mood ?? null);
    h.dragonflies(null);
    this.el.vf.style.display = shot.viewfinder ? 'block' : 'none';
    this.el.vfInfo.textContent = shot.viewfinder ?? '';
    const keys = shot.path();
    this.posCurve = new THREE.CatmullRomCurve3(keys.map((k) => k.pos), false, 'centripetal');
    this.lookCurve = new THREE.CatmullRomCurve3(keys.map((k) => k.look), false, 'centripetal');
    this.rollCurve = keys.some((k) => k.roll) ? new THREE.CatmullRomCurve3(keys.map((k) => V(k.roll ?? 0, 0, 0))) : null;
    this.el.title.textContent = shot.title ?? '';
    this.el.line.textContent = shot.line ?? '';
    this.captionAge = 0;
    this.pending = null;
    this.el.cardTitle.textContent = shot.card?.title ?? '';
    this.el.cardLine.textContent = shot.card?.line ?? '';
  }

  /** Advances the film by `dt` real seconds and places `eye`; false once it's over. */
  update(dt: number, eye: THREE.Object3D): boolean {
    if (!this.active) return false;
    this.t += dt;
    let shot = this.shots[this.index];
    let cut = false;
    if (this.t >= shot.duration) {
      if (this.index + 1 >= this.shots.length) {
        this.stop();
        return false;
      }
      this.begin(this.index + 1);
      shot = this.shots[this.index];
      cut = true;
    }
    const t = this.t, d = shot.duration;
    for (const cue of shot.cues ?? []) {
      if (!this.done.has(cue) && t >= cue.at) {
        this.done.add(cue);
        cue.run();
      }
    }

    // The clock.
    const hours = THREE.MathUtils.lerp(shot.hours[0], shot.hours[1], t / d);
    this.sinceLight += dt;
    const relight = this.sinceLight > 0.15 && shot.hours[0] !== shot.hours[1];
    if (relight) this.sinceLight = 0;
    this.host.setTime(hours, relight);

    // The camera: along the shot's spline, kept clear of the ground (looking a little ahead, so it rises early),
    // aimed along the look spline.
    const u = ease(clamp01(t / d));
    const p = this.posCurve.getPoint(u);
    const ahead = this.posCurve.getPoint(ease(clamp01((t + 0.8) / d)));
    const f = this.host.fns;
    const ground = Math.max(f.height(p.x, p.z), f.height(ahead.x, ahead.z), 0);
    const need = ground + (shot.clearance ?? 1.5) - p.y;
    this.lift = Math.max(need, this.lift - dt * 1.5, 0);
    p.y += this.lift;
    eye.position.copy(p);
    this.m.lookAt(p, this.lookCurve.getPoint(u), this.up);
    eye.quaternion.setFromRotationMatrix(this.m);
    if (this.rollCurve) eye.rotateZ(-this.rollCurve.getPoint(u).x);
    if (cut) this.host.cut();

    // Fades at the cuts and dips at the cues.
    let black = Math.max(
      shot.fadeIn === 0 ? 0 : 1 - t / (shot.fadeIn ?? 0.8),
      shot.fadeOut === 0 ? 0 : 1 - (d - t) / (shot.fadeOut ?? 0.8),
      0,
    );
    for (const cue of shot.cues ?? []) if (cue.dip) black = Math.max(black, 1 - Math.abs(t - cue.at) / 0.45);
    this.el.fade.style.opacity = clamp01(black).toFixed(3);

    // The caption: in after a beat, out before the cut; a new one waits for the old to fade.
    this.captionAge += dt;
    let alpha = clamp01((this.captionAge - 0.9) / 0.8) * clamp01((d - t - 1.0) / 0.6);
    if (this.pending) {
      this.pendingAge += dt;
      alpha *= 1 - clamp01(this.pendingAge / 0.4);
      if (this.pendingAge >= 0.4) {
        this.el.title.textContent = this.pending.title;
        this.el.line.textContent = this.pending.line;
        this.pending = null;
        this.captionAge = 0.5;
      }
    }
    const card = shot.card;
    const cardAlpha = card ? clamp01((t - card.from) / 1.2) * clamp01((card.to - t) / 1.2) : 0;
    this.el.card.style.opacity = cardAlpha.toFixed(3);
    // (The caption steps aside for the title card.)
    const shown = this.captions && !!(this.el.title.textContent || this.el.line.textContent);
    this.el.caption.style.opacity = shown ? (alpha * (1 - cardAlpha)).toFixed(3) : '0';

    // The shutter: a white flash, then the print slides into the corner and fades away.
    this.flashAge += dt;
    this.el.flash.style.opacity = (0.85 * (1 - clamp01(this.flashAge / 0.45))).toFixed(3);
    this.printAge += dt;
    const pIn = clamp01((this.printAge - 0.3) / 0.6), pOut = clamp01((this.printAge - 4.2) / 0.8);
    this.el.print.style.opacity = (pIn * (1 - pOut)).toFixed(3);
    this.el.print.style.transform = `translate(${(1 - pIn) * 40}px, ${(1 - pIn) * 30}px) rotate(${-4 + 2 * pIn}deg)`;
    return true;
  }

  /** The shots, laid out from this world. */
  private plan(): Shot[] {
    const h = this.host;
    const f = h.fns;
    const ground = (x: number, z: number) => Math.max(f.height(x, z), 0);
    const at = (x: number, up: number, z: number) => V(x, ground(x, z) + up, z);
    const shoreAt = (z: number) => {
      for (let x = -100; x < 900; x += 2) if (f.height(x, z) < -0.4) return x;
      return 300;
    };
    const shore = shoreAt(0);
    const start = { x: -30, z: 0 };
    const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
    const byNear = (kind: string) =>
      f.landmarks.filter((l) => l.kind === kind && f.forest(l.x, l.z) < 0.3).sort((a, b) => dist(a, start) - dist(b, start))[0];
    const circle = byNear('circle');
    const oak = byNear('oak');
    // What the meadow shots head for: the giant oak, else a stone circle.
    const mark = oak ?? circle ?? { x: -200, z: -100, radius: 12, kind: 'oak' as const };
    const fall = [...f.waterfalls].sort((a, b) => dist(a, start) - dist(b, start))[0];
    // Deep, level stretches of forest near the start, well apart (a different wood for each forest shot).
    const deepWoods: { x: number; z: number }[] = [];
    for (let x = -980; x < 980; x += 20) {
      for (let z = -980; z < 980; z += 20) {
        if (dist({ x, z }, start) > 700 || f.height(x, z) < 3) continue;
        let deep = true;
        for (const [dx, dz] of [[0, 0], [20, 0], [-20, 0], [0, 20], [0, -20], [35, 35], [-35, 35], [35, -35], [-35, -35]]) {
          if (f.forest(x + dx, z + dz) < 0.8 || f.clearing(x + dx, z + dz) > 0.02) deep = false;
        }
        if (deep && Math.abs(f.height(x + 10, z) - f.height(x - 10, z)) < 3 && Math.abs(f.height(x, z + 10) - f.height(x, z - 10)) < 3) deepWoods.push({ x, z });
      }
    }
    deepWoods.sort((a, b) => dist(a, start) - dist(b, start));
    const woods: { x: number; z: number }[] = [];
    for (const c of deepWoods) if (woods.length < 3 && woods.every((w) => dist(w, c) > 120)) woods.push(c);
    // Directions toward (and away from) the sun across the ground, for the time a shot has just set.
    const sunFlat = () => new THREE.Vector2(h.sunDir.x, h.sunDir.z).normalize();
    // The trees on a 10 m grid, to keep camera lines out of trunks and crowns.
    const grid = new Map<string, { x: number; z: number; r: number; broad: boolean }[]>();
    for (const tr of h.trees()) {
      const k = `${Math.floor(tr.x / 10)},${Math.floor(tr.z / 10)}`;
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(tr);
    }
    /** Nothing within `margin` of a crown (or of a trunk, with `trunks`) at (x, z). */
    const clearAt = (x: number, z: number, margin: number, trunks = false) => {
      const ix = Math.floor(x / 10), iz = Math.floor(z / 10);
      for (let a = ix - 2; a <= ix + 2; a++) {
        for (let b = iz - 2; b <= iz + 2; b++) {
          for (const tr of grid.get(`${a},${b}`) ?? []) if (Math.hypot(tr.x - x, tr.z - z) < (trunks ? 0.6 : tr.r) + margin) return false;
        }
      }
      return true;
    };
    /** The share of points along a line (every 3 m) that are clear. */
    const clearLine = (x0: number, z0: number, x1: number, z1: number, margin: number, trunks = false) => {
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 3));
      let ok = 0;
      for (let i = 0; i <= n; i++) if (clearAt(x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n, margin, trunks)) ok++;
      return ok / (n + 1);
    };

    /** A line of `half` m each side of `o` along (dx, dz), shifted sideways until it misses every trunk. */
    const clearWalk = (o: { x: number; z: number }, dx: number, dz: number, half: number) => {
      for (let side = 0; side <= 24; side += 2) {
        for (const sgn of [1, -1]) {
          const cx = o.x - dz * side * sgn, cz = o.z + dx * side * sgn;
          if (clearLine(cx - dx * half, cz - dz * half, cx + dx * half, cz + dz * half, 1.2, true) === 1) return { x: cx, z: cz };
        }
      }
      return o;
    };

    const wood0 = () => woods[0] ?? start;
    const shots: Shot[] = [];

    // --- New shots, up front for review (to be moved to their places in the film).

    // A drone run: off the highest fall, down its gorge at full speed and out over the sea, banking through the bends.
    const tallFall = [...f.waterfalls].sort((a, b) => b.top - a.top)[0];
    if (tallFall) {
      shots.push({
        duration: 20,
        hours: [18.3, 18.45],
        weather: 'fair',
        fadeIn: 2,
        clearance: 6,
        title: 'Drone run',
        line: 'Off the falls and down the gorge at full throttle, out over the sea.',
        path: () => {
          const w = tallFall;
          const plunge = { x: w.x + w.dirX * 14, z: w.z + w.dirZ * 14 };
          // The river the fall pours into, followed by its centerline.
          const rivers = f.riverCenters(plunge.x);
          let ri = 0;
          rivers.forEach((r, i) => Math.abs(r.z - plunge.z) < Math.abs(rivers[ri].z - plunge.z) && (ri = i));
          const mid = (x: number) => f.riverCenters(x)[ri].z;
          // Easing away from the falls, then faster and faster: the keys are evenly spaced in time.
          const xs = [plunge.x + 10, plunge.x + 22, plunge.x + 45, plunge.x + 80];
          for (let x = plunge.x + 125; xs.length < 40; x += 46) {
            xs.push(x);
            if (x > 0 && f.height(x, mid(x)) < -5) break;
          }
          const keys: Key[] = xs.map((x, i) => {
            const up = i === 0 ? 16 : 12;
            return {
              pos: at(x, up, mid(x)),
              look: i === 0 ? V(w.x, w.top * 0.6, w.z) : at(x + 90, up - 3, mid(x + 90)),
            };
          });
          // Out over the sea, climbing.
          const last = xs[xs.length - 1], z = mid(last);
          keys.push({ pos: V(last + 120, 22, z), look: V(last + 600, 18, z) }, { pos: V(last + 230, 34, z), look: V(last + 800, 22, z) });
          // Bank into the bends: roll with the change of heading.
          const heading = (i: number) => Math.atan2(keys[i + 1].pos.z - keys[i].pos.z, keys[i + 1].pos.x - keys[i].pos.x);
          for (let i = 2; i < keys.length - 1; i++) {
            let turn = heading(i) - heading(i - 1);
            turn = Math.atan2(Math.sin(turn), Math.cos(turn));
            keys[i].roll = Math.max(-0.45, Math.min(0.45, turn * 3));
          }
          return keys;
        },
      });
    }

    // A day in thirty seconds, from a headland over the coast: the sun sets over the sea, the northern lights come
    // out, dawn lights the land from behind, and it's afternoon again.
    shots.push({
      duration: 30,
      hours: [15, 39],
      weather: 'fair',
      aurora: 1.2,
      clearance: 8,
      title: 'A day',
      line: 'Twenty-four hours in thirty seconds.',
      path: () => {
        // A high, open spot a little back from the shore, near the start.
        let best = { x: shore - 60, z: 0, score: -1e9 };
        for (let z = -320; z <= 320; z += 20) {
          const sx = shoreAt(z);
          for (const back of [35, 55, 80, 110]) {
            const x = sx - back;
            if (f.forest(x, z) > 0.3) continue;
            // No crown in front of the lens: the drift and the first stretch of the view must miss every tree.
            if (clearLine(x - 2, z + 2, x + 12, z - 8, 3) < 1) continue;
            const lx = 320, lz = -260, ll = Math.hypot(lx, lz);
            if (clearLine(x + 5, z - 3, x + 5 + (lx / ll) * 45, z - 3 + (lz / ll) * 45, 2.5) < 1) continue;
            const score = f.height(x, z) - Math.abs(z) * 0.03;
            if (score > best.score) best = { x, z, score };
          }
        }
        const look = (x: number, z: number) => at(x + 320, 12, z - 260);
        return [0, 0.5, 1].map((k) => {
          const x = best.x + 10 * k, z = best.z - 6 * k;
          return { pos: at(x, 9, z), look: look(x, z) };
        });
      },
    });

    // The pond in the evening: low over the water, dragonflies hunting in the light, the far shore soft.
    const pond = [...f.ponds].sort((a, b) => dist(a, start) - dist(b, start))[0];
    if (pond) {
      shots.push({
        duration: 16,
        hours: [17.7, 17.8],
        weather: 'clear',
        lens: { focal: 50, fStop: 1.8 },
        clearance: 0.2,
        title: 'The pond',
        line: 'Dragonflies hunting over the water in the evening light.',
        path: () => {
          // From the shore away from the sun, looking across the water into the light.
          const s = sunFlat();
          let d = 0;
          while (d < pond.radius * 2.5 && f.pondEdge(pond.x - s.x * d, pond.z - s.y * d) < 0) d += 0.25;
          const sx = pond.x - s.x * d, sz = pond.z - s.y * d;
          const lure = V(sx + s.x * 3.2, pond.level + 0.45, sz + s.y * 3.2);
          h.dragonflies(lure);
          const px = -s.y, pz = s.x;
          return [-1, 0, 1].map((k) => ({
            pos: V(sx + s.x * 0.7 + px * k * 0.9, pond.level + 0.55, sz + s.y * 0.7 + pz * k * 0.9),
            look: V(lure.x + px * k * 0.3, lure.y, lure.z + pz * k * 0.3),
          }));
        },
      });
    }

    // The seasons at a woodland edge: the land turns through the year as we drift along it, with no cuts.
    const seasonLine: Record<Season, string> = {
      spring: 'Blossom on the thorn and the wild cherry, fresh green in the meadow.',
      summer: 'Long days, and here and there a tree already turning.',
      autumn: 'Gold, copper and red, and the meadow gone to seed.',
      winter: 'Snow on the boughs, and bare branches.',
    };
    const seasonTitle: Record<Season, string> = { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' };
    const turnTo = (at: number, s: Season): Cue => ({
      at,
      run: () => {
        h.season(s, false);
        this.say(seasonTitle[s], seasonLine[s]);
      },
    });
    shots.push({
      duration: 32,
      hours: [14.6, 14.9],
      weather: 'clear',
      season: 'spring',
      clearance: 2,
      title: seasonTitle.spring,
      line: seasonLine.spring,
      path: () => {
        // A meadow facing the edge of a broadleaf wood, with the sun over our shoulder so the leaves show
        // their colors: the blossom, the turning, the snow. Scored by broadleaf crowns in a wedge ahead.
        const s = sunFlat();
        const sunA = Math.atan2(s.y, s.x);
        let best: { x: number; z: number; a: number; score: number } | null = null;
        for (let x = -700; x <= 500; x += 16) {
          for (let z = -600; z <= 600; z += 16) {
            if (dist({ x, z }, start) > 650 || dist({ x, z }, mark) < 90) continue;
            if (f.height(x, z) < 2 || f.forest(x, z) > 0.25 || f.clearing(x, z) > 0.3) continue;
            if (!clearAt(x, z, 6)) continue;
            for (const off of [-0.4, -0.2, 0, 0.2, 0.4]) {
              const a = sunA + Math.PI + off;
              const ux = Math.cos(a), uz = Math.sin(a);
              // The camera crabs 24 m across the view: that line must be open, and so must 35 m of meadow ahead.
              const px = -uz, pz = ux;
              if (clearLine(x - px * 14, z - pz * 14, x + px * 14, z + pz * 14, 2.5) < 1) continue;
              if (clearLine(x, z, x + ux * 35, z + uz * 35, 2) < 1) continue;
              let broad = 0, needles = 0;
              const ix = Math.floor(x / 10), iz = Math.floor(z / 10);
              for (let gi = ix - 12; gi <= ix + 12; gi++) {
                for (let gk = iz - 12; gk <= iz + 12; gk++) {
                  for (const tr of grid.get(`${gi},${gk}`) ?? []) {
                    const dx = tr.x - x, dz = tr.z - z;
                    const along = dx * ux + dz * uz, across = Math.abs(dx * px + dz * pz);
                    if (along < 40 || along > 120 || across > along * 0.6) continue;
                    if (tr.broad) broad++;
                    else needles++;
                  }
                }
              }
              // Mostly broadleaf, the light square behind us, and not too far from the start.
              const score = broad - 2.5 * needles - Math.abs(off) * 3 - dist({ x, z }, start) * 0.004;
              if (broad >= 8 && (!best || score > best.score)) best = { x, z, a, score };
            }
          }
        }
        const o = best ?? { x: mark.x - 40, z: mark.z, a: 0 };
        const ux = Math.cos(o.a), uz = Math.sin(o.a), px = -uz, pz = ux;
        const focus = at(o.x + ux * 70, 7, o.z + uz * 70);
        return [-1, -0.5, 0, 0.5, 1].map((k) => ({
          pos: at(o.x + px * k * 12, 3.5 + (k + 1) * 1.2, o.z + pz * k * 12),
          look: V(focus.x + px * k * 4, focus.y, focus.z + pz * k * 4),
        }));
      },
      cues: [turnTo(8, 'summer'), turnTo(16, 'autumn'), turnTo(24, 'winter')],
    });


    // Dawn over the sea, low over the swell toward the land, the sun coming up behind it.
    shots.push({
      duration: 24,
      hours: [5.6, 6.2],
      weather: 'fair',
      fadeIn: 2.5,
      clearance: 3,
      card: { title: 'Meadows', line: 'A northern wilderness, grown from a single seed and drawn live in your browser', from: 2.5, to: 11 },
      path: () => [
        { pos: V(shore + 330, 7, 40), look: V(shore - 300, 18, 10) },
        { pos: V(shore + 210, 5, 28), look: V(shore - 300, 15, 0) },
        { pos: V(shore + 100, 4, 14), look: V(shore - 300, 12, -10) },
        { pos: at(shore + 12, 3.5, 6), look: at(mark.x, 10, mark.z) },
      ],
    });

    // Into the deep forest at sunrise: the sun low through the trunks, the sky orange to blue beyond them, mist
    // on the ground and spores glittering in the beams.
    if (woods.length) {
      const wood = (i: number) => woods[Math.min(i, woods.length - 1)];
      // Walking toward the sun.
      shots.push({
        duration: 16,
        hours: [6.35, 6.5],
        weather: 'clear',
        mood: FOREST,
        clearance: 1.6,
        title: 'The deep forest',
        line: 'Morning mist between the trunks, and the low sun cutting through in beams.',
        path: () => {
          const s = sunFlat();
          const o = clearWalk(wood(0), s.x, s.y, 8);
          return [0, 0.5, 1].map((k) => {
            const x = o.x + s.x * (k * 14 - 7), z = o.z + s.y * (k * 14 - 7);
            return { pos: at(x, 1.8, z), look: at(x + s.x * 30, 4 + 2 * k, z + s.y * 30) };
          });
        },
      });
      // Rising out of the ferns, into the light.
      shots.push({
        duration: 14,
        hours: [6.6, 6.7],
        weather: 'clear',
        mood: FOREST,
        clearance: 0.35,
        title: 'Spores and pollen',
        line: 'Motes drift and glitter where the light falls, over ferns and moss.',
        path: () => {
          const s = sunFlat();
          const o = clearWalk(wood(1), s.x, s.y, 4);
          return [0, 0.5, 1].map((k) => {
            const x = o.x + s.x * (k * 6 - 3), z = o.z + s.y * (k * 6 - 3);
            return { pos: at(x, 0.5 + 3 * k * k, z), look: at(x + s.x * 18, 1.2 + 5 * k, z + s.y * 18) };
          });
        },
      });
      // Tracking sideways past the trunks, the beams slanting toward us between them.
      shots.push({
        duration: 14,
        hours: [6.85, 6.95],
        weather: 'clear',
        mood: FOREST,
        clearance: 1.4,
        title: 'Under the canopy',
        line: 'Every trunk throws its own shadow through the haze.',
        path: () => {
          const s = sunFlat();
          const px = -s.y, pz = s.x;
          const o = clearWalk(wood(2), px, pz, 8);
          return [0, 0.5, 1].map((k) => {
            const x = o.x + px * (k * 16 - 8), z = o.z + pz * (k * 16 - 8);
            return { pos: at(x, 1.7, z), look: at(x + s.x * 30 + px * 4, 5, z + s.y * 30 + pz * 4) };
          });
        },
      });
    }

    // Skimming the meadow grass toward the giant oak in the morning light.
    shots.push({
      duration: 20,
      hours: [8.1, 8.5],
      weather: 'fair',
      clearance: 1.3,
      title: 'The meadows',
      line: 'Every blade of grass is real geometry, swaying in the wind and wet with dew. Turn the sound up: wind, birdsong, the surf.',
      path: () => {
        // In toward it from 130 m out, along a line clear of trees over open meadow, the sun at our back.
        const s = sunFlat();
        const near = Math.max(mark.radius * 3, 30), far = 130;
        let best = { score: -1e9, ox: 1, oz: 0 };
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 18) {
          const ox = Math.cos(a), oz = Math.sin(a);
          let open = 0;
          for (let d = near; d <= far; d += 10) open += f.height(mark.x + ox * d, mark.z + oz * d) > 1.5 && f.forest(mark.x + ox * d, mark.z + oz * d) < 0.4 ? 1 : 0;
          const clear = clearLine(mark.x + ox * near, mark.z + oz * near, mark.x + ox * far, mark.z + oz * far, 3);
          const score = clear * 4 + open / 12 + (ox * s.x + oz * s.y);
          if (score > best.score) best = { score, ox, oz };
        }
        const along = (d: number, up: number) => at(mark.x + best.ox * d, up, mark.z + best.oz * d);
        return [far, far * 0.7 + near * 0.3, far * 0.35 + near * 0.65, near].map((d, i) => ({ pos: along(d, 1.9 - 0.15 * i), look: at(mark.x, 3, mark.z) }));
      },
    });

    // A real lens: 85 mm wide open, crabbing low past the meadow flowers with the oak soft behind.
    shots.push({
      duration: 16,
      hours: [9, 9.1],
      weather: 'fair',
      lens: { focal: 85, fStop: 1.4 },
      clearance: 0.6,
      title: 'A real lens',
      line: '85 mm at f/1.4: depth of field and bokeh while you play, not only in photo mode.',
      path: () => {
        // Looking at it from 45 m out on its most meadowy side (high grassy ground, no trees between); sliding sideways 7 m.
        let best = { score: -1e9, ux: 1, uz: 0 };
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 18) {
          const ux = Math.cos(a), uz = Math.sin(a);
          let grass = 0;
          for (let d = 30; d <= 60; d += 5) {
            const x = mark.x + ux * d, z = mark.z + uz * d;
            grass += f.height(x, z) > 3 && f.forest(x, z) < 0.3 ? 1 : 0;
          }
          const score = grass + 4 * clearLine(mark.x + ux * 15, mark.z + uz * 15, mark.x + ux * 50, mark.z + uz * 50, 2);
          if (score > best.score) best = { score, ux, uz };
        }
        const { ux, uz } = best, sx = -uz, sz = ux;
        const base = { x: mark.x + ux * 45, z: mark.z + uz * 45 };
        return [-1, 0, 1].map((k) => {
          const cx = base.x + sx * 3.5 * k, cz = base.z + sz * 3.5 * k;
          return { pos: at(cx, 0.9, cz), look: at(cx - ux * 9, 0.45, cz - uz * 9) };
        });
      },
    });

    if (fall) {
      // Along the gorge: u downstream from the plunge pool, v across.
      const px = fall.x + fall.dirX * 8, pz = fall.z + fall.dirZ * 8;
      const g = (u: number, v: number) => ({ x: px + fall.dirX * u - fall.dirZ * v, z: pz + fall.dirZ * u + fall.dirX * v });
      const gat = (u: number, v: number, up: number) => {
        const q = g(u, v);
        return at(q.x, up, q.z);
      };
      const lip = V(fall.x, fall.top * 0.55, fall.z);
      // Up the river to the falls, the low sun behind, a rainbow in the spray.
      shots.push({
        duration: 18,
        hours: [18.15, 18.35],
        weather: 'clear',
        clearance: 2.5,
        title: 'Waterfalls',
        line: 'A forest stream pours over the gorge rim, and the low sun paints a rainbow in the spray.',
        path: () => [
          { pos: gat(62, 0, 6), look: lip },
          { pos: gat(42, 2, 4.5), look: lip },
          { pos: gat(30, 3, 3.5), look: lip.clone().setY(fall.top * 0.42) },
        ],
      });
      // Rising along the gorge wall.
      shots.push({
        duration: 14,
        hours: [15, 15.15],
        weather: 'clear',
        noSprayBow: true,
        clearance: 2,
        title: 'Real rock',
        line: 'Close up, the cliffs are rebuilt at half-meter detail: buttresses, ledges and layered beds of stone.',
        path: () => [
          { pos: gat(18, -8, 3), look: gat(8, 14, 12) },
          { pos: gat(24, -5, 6), look: gat(14, 15, 12) },
          { pos: gat(31, -2, 10), look: gat(22, 16, 10) },
        ],
      });
    }

    // The coast in the afternoon: gulls over the surf, and a whale breaching offshore.
    const whaleZ = 10, whaleX = shoreAt(whaleZ) + 130;
    shots.push({
      duration: 22,
      hours: [15.5, 15.8],
      weather: 'fair',
      // A long lens stopped down: the whale fills the frame and the sea stays sharp.
      lens: { focal: 70, fStop: 11 },
      clearance: 1.2,
      title: 'The coast',
      line: 'Gulls wheel over the surf, and out at sea a whale breaches.',
      path: () => [
        { pos: at(shore - 14, 2.6, -8), look: V(whaleX, 5, whaleZ) },
        { pos: at(shore - 10, 2.4, -4), look: V(whaleX, 4, whaleZ) },
        { pos: at(shore - 6, 2.2, 0), look: V(whaleX, 4, whaleZ + 4) },
      ],
      cues: [
        { at: 2.5, run: () => h.whale({ x: whaleX, z: whaleZ }, 'breach') },
        { at: 12.5, run: () => h.whale({ x: whaleX + 20, z: whaleZ + 12 }, 'blow') },
      ],
    });

    // A shower passes over the land; the sun breaks through behind, a rainbow.
    shots.push({
      duration: 26,
      hours: [17.85, 18.05],
      weather: 'rain',
      clearance: 3,
      title: 'Weather',
      line: 'Showers roll in off the sea; the land goes dark and wet.',
      path: () => {
        const s = sunFlat();
        const base = { x: shore - 70, z: 20 };
        return [0, 1, 2].map((k) => ({
          pos: at(base.x - s.x * k * 15, 14 - k * 2, base.z - s.y * k * 15),
          look: V(base.x - s.x * 400, 45, base.z - s.y * 400),
        }));
      },
      cues: [
        { at: 9, run: () => h.weather('clear', false) },
        { at: 11, run: () => this.say('Weather', 'When the sun breaks through behind you: a rainbow.') },
      ],
    });

    // The vibes: one golden-hour orbit, a color mood every couple of seconds.
    const vibes = Object.keys(VIBES) as VibeName[];
    const vibeAt = mark as { x: number; z: number; radius: number };
    const per = 25 / vibes.length;
    shots.push({
      duration: 25,
      hours: [17, 17.3],
      weather: 'fair',
      clearance: 3,
      title: 'Vibes',
      line: VIBES[vibes[0]].label,
      path: () => {
        const r = Math.max(vibeAt.radius * 3.2, 40);
        return [0, 1, 2, 3, 4].map((i) => {
          const a = 0.4 + i * 0.35;
          return { pos: at(vibeAt.x + Math.cos(a) * r, 8 + i, vibeAt.z + Math.sin(a) * r), look: at(vibeAt.x, 8, vibeAt.z) };
        });
      },
      cues: vibes.slice(1).map((v, i) => ({
        at: per * (i + 1),
        run: () => {
          h.vibe(v);
          this.el.line.textContent = VIBES[v].label;
        },
      })),
    });

    // Photo mode: time stops mid-wave; the camera glides through the frozen surf and takes the shot.
    shots.push({
      duration: 16,
      hours: [18.7, 18.7],
      weather: 'fair',
      freeze: true,
      viewfinder: '35 mm · f/2 · 1/500 s · time frozen',
      lens: { focal: 35, fStop: 2 },
      clearance: 0.9,
      title: 'Photo mode',
      line: 'Freeze time, choose a lens, frame the shot, and keep it.',
      path: () => {
        // On the wet sand at the water's edge (the beach's rocks lie higher up), looking along the surf line.
        const p = [-16, -4, 8].map((z) => ({ x: shoreAt(z) - 3, z }));
        return p.map((q) => ({ pos: at(q.x, 1.1, q.z), look: V(shoreAt(q.z + 30) + 4, 0.2, q.z + 30) }));
      },
      cues: [{ at: 10.5, run: () => h.capture() }],
    });

    // Dusk from inside the forest: the low sun off to one side through the trunks, so the sky between the crowns runs
    // from orange around it to blue away from it.
    shots.push({
      duration: 16,
      hours: [19.05, 19.2],
      weather: 'clear',
      mood: DUSK,
      clearance: 1.5,
      title: 'Dusk in the woods',
      line: 'Through the crowns the sky runs from burning orange to evening blue.',
      path: () => {
        const s = sunFlat();
        // Looking 50 degrees off the sun, drifting slowly the other way.
        const a = DUSK_OFF;
        const lx = s.x * Math.cos(a) - s.y * Math.sin(a), lz = s.x * Math.sin(a) + s.y * Math.cos(a);
        const o = clearWalk(wood0(), -lz, lx, 6);
        return [0, 0.5, 1].map((k) => {
          const x = o.x - lz * (k * 12 - 6), z = o.z + lx * (k * 12 - 6);
          return { pos: at(x, 1.7, z), look: at(x + lx * 30, 9 + 2 * k, z + lz * 30) };
        });
      },
    });

    // Sunset: climbing out over the land toward the sea.
    shots.push({
      duration: 22,
      hours: [19, 19.4],
      weather: 'fair',
      clearance: 3,
      path: () => [
        { pos: at(-60, 4, 10), look: V(shore + 1200, 40, 0) },
        { pos: at(-100, 40, 0), look: V(shore + 1500, 10, 0) },
        { pos: at(-150, 150, -10), look: V(shore + 1500, 0, 0) },
      ],
    });

    // Night: the northern lights over the meadow, and the end card.
    shots.push({
      duration: 26,
      hours: [22.8, 23],
      weather: 'clear',
      aurora: 1.3,
      clearance: 2,
      fadeOut: 3,
      title: 'Night',
      line: 'Moonlight, a sky full of stars, and the northern lights.',
      card: { title: 'Meadows', line: 'Real-time in the browser · Three.js and WebGL2', from: 15, to: 25.5 },
      path: () => [
        { pos: at(shore - 40, 2.2, 40), look: V(shore - 160, 50, -300) },
        { pos: at(shore - 45, 2.4, 30), look: V(shore - 20, 70, -320) },
        { pos: at(shore - 50, 2.6, 20), look: V(shore + 140, 80, -300) },
      ],
    });
    return shots;
  }
}
