import * as THREE from 'three';
import type { WorldFns } from './worldgen';

/**
 * The soundscape, all synthesized with Web Audio (no sample files): beds of filtered noise for the wind, leaves,
 * surf, rivers, rain and each waterfall's roar, and creatures voiced from oscillators: birdsong by day (a dawn
 * chorus, a skylark over the meadows, a woodpecker in the woods), crickets on summer nights, owls in
 * the forest, frogs at the ponds. The torch crackles; footsteps change with the ground underfoot.
 *
 * Positional sounds (waterfalls, birds, owls, frogs) go through equal-power panners that follow the camera; every
 * voice can send to a shared reverb, generated as decaying noise, which gives the woods their space.
 *
 * Browsers only start audio after a click or key press: `unlock()` is wired to both.
 */

export interface SoundFrame {
  dt: number;
  camera: THREE.Camera;
  /** The player's feet, and whether they're walking on the ground (not flying or mid-jump). */
  feet: THREE.Vector3;
  grounded: boolean;
  /** Feet that came down since last frame, from the character's gait (null: none shown, go by distance). */
  footfalls: number | null;
  /** Hours 0-24, and 0..1 how much of the day's light there is. */
  hours: number;
  daylight: number;
  rain: number;
  snow: number;
  snowCover: number;
  /** The wind slider (1 = normal). */
  wind: number;
  torch: boolean;
}

type Surface = 'grass' | 'leaves' | 'sand' | 'stone' | 'snow' | 'water' | 'dirt';

/** What the listener's surroundings are like (sampled a few times a second). */
interface Place {
  /** Meters to the open sea, to a river, and to the nearest pond's shore (with its center). */
  sea: number;
  river: number;
  pond: null | { x: number; z: number; d: number };
  /** 0..1 how wooded it is nearby, and how high and open. */
  forest: number;
  open: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const smooth = (x: number, a: number, b: number) => THREE.MathUtils.smoothstep(x, a, b);

/** Loopable noise: the start is crossfaded from the tail's continuation, so the loop seam doesn't click. */
function noiseBuffer(ctx: AudioContext, kind: 'white' | 'pink' | 'brown', seconds = 5) {
  const len = Math.floor(ctx.sampleRate * seconds), fade = 4096;
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const raw = new Float32Array(len + fade);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < raw.length; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') raw[i] = w * 0.5;
      else if (kind === 'pink') {
        // Paul Kellet's filter.
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        raw[i] = last * 3.5;
      }
    }
    const out = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) out[i] = raw[i];
    for (let i = 0; i < fade; i++) out[i] = THREE.MathUtils.lerp(raw[len + i], raw[i], i / fade);
  }
  return buf;
}

/** A small hall: stereo noise decaying over a couple of seconds, a little darker as it fades. */
function reverbImpulse(ctx: AudioContext, seconds = 2.4) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const w = Math.random() * 2 - 1;
      lp += (w - lp) * (0.9 - 0.75 * t);
      d[i] = lp * Math.pow(1 - t, 3) * (i < ctx.sampleRate * 0.012 ? i / (ctx.sampleRate * 0.012) : 1);
    }
  }
  return buf;
}

/** A looping noise source through a filter chain into a gain, for the ambient beds. */
interface Bed {
  gain: GainNode;
  filters: BiquadFilterNode[];
}

export class Soundscape {
  readonly settings = { on: true, volume: 0.3 };
  private ctx?: AudioContext;
  private master!: GainNode;
  /** Muffles the whole mix a little under a blanket of snow. */
  private muffle!: BiquadFilterNode;
  private reverb!: ConvolverNode;
  private noise!: Record<'white' | 'pink' | 'brown', AudioBuffer>;
  private beds!: Record<'wind' | 'whistle' | 'leaves' | 'surf' | 'river' | 'rain' | 'patter' | 'torch', Bed>;
  private falls: { gain: GainNode; panner: PannerNode; sources: AudioBufferSourceNode[]; pos: THREE.Vector3 }[] = [];
  private crickets: { osc: OscillatorNode; gain: GainNode; next: number; period: number; pitch: number; amp: number }[] = [];
  private suspendAt?: number;
  private nextBird = 0;
  private nextOwl = 0;
  private nextFrog = 0;
  private nextCrackle = 0;
  private nextWave = 0;
  private nextBabble = 0;
  private nextDrip = 0;
  private stride = 0;
  private wasGrounded = true;
  private lastFeet = new THREE.Vector3();
  private sinceSurvey = 1;
  private place: Place = { sea: 1e9, river: 1e9, forest: 0, open: 0.5, pond: null };
  private v = new THREE.Vector3();
  private fwd = new THREE.Vector3();
  private up = new THREE.Vector3();

  constructor(private world: WorldFns) {}

  /** Starts (or resumes) audio; browsers allow that only from a user gesture. */
  unlock() {
    if (!this.ctx) this.build();
    if (this.ctx!.state === 'suspended') void this.ctx!.resume();
  }

  /** A new world: the waterfalls (and ponds) have moved. */
  setWorld(world: WorldFns) {
    this.world = world;
    if (this.ctx) this.buildFalls();
  }

  private build() {
    const ctx = (this.ctx = new AudioContext());
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.knee.value = 6;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 18000;
    this.muffle.connect(limiter);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.muffle);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = reverbImpulse(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    this.reverb.connect(wet).connect(this.master);
    this.noise = { white: noiseBuffer(ctx, 'white'), pink: noiseBuffer(ctx, 'pink'), brown: noiseBuffer(ctx, 'brown') };

    const bed = (kind: 'white' | 'pink' | 'brown', filters: [BiquadFilterType, number, number][]): Bed => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise[kind];
      src.loop = true;
      src.loopStart = Math.random();
      let node: AudioNode = src;
      const fs = filters.map(([type, f, q]) => {
        const b = ctx.createBiquadFilter();
        b.type = type;
        b.frequency.value = f;
        b.Q.value = q;
        node = node.connect(b);
        return b;
      });
      const gain = ctx.createGain();
      gain.gain.value = 0;
      node.connect(gain).connect(this.master);
      src.start(0, rand(0, 4));
      return { gain, filters: fs };
    };
    this.beds = {
      // Low roar of moving air, its color rising with the gusts.
      wind: bed('brown', [['bandpass', 380, 0.6], ['lowpass', 1400, 0.5]]),
      // A thin whistle when it blows hard.
      whistle: bed('white', [['bandpass', 900, 12], ['bandpass', 900, 6]]),
      // Leaves rustling in the canopy.
      leaves: bed('white', [['highpass', 1800, 0.5], ['lowpass', 7500, 0.5]]),
      // Waves: a dark swell, opened up as each one breaks.
      surf: bed('pink', [['lowpass', 500, 0.6], ['highpass', 60, 0.5]]),
      // Rivers babble: two resonant bands wobbled from moment to moment.
      river: bed('white', [['bandpass', 1300, 1.2], ['peaking', 2900, 2]]),
      rain: bed('white', [['highpass', 800, 0.5], ['lowpass', 9000, 0.5]]),
      // Rain on the leaves overhead, under the trees.
      patter: bed('white', [['bandpass', 3800, 1.5]]),
      // The torch's flame: a soft breathy rush.
      torch: bed('brown', [['bandpass', 320, 0.8]]),
    };
    // Crickets: a handful, each chirping on its own clock and pitch.
    for (let i = 0; i < 6; i++) {
      const osc = ctx.createOscillator();
      const pitch = rand(4100, 4900);
      osc.frequency.value = pitch;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      pan.pan.value = rand(-0.9, 0.9);
      osc.connect(gain).connect(pan).connect(this.master);
      osc.start();
      this.crickets.push({ osc, gain, next: ctx.currentTime + rand(0, 1), period: rand(0.45, 0.85), pitch, amp: rand(0.035, 0.07) });
    }
    this.buildFalls();
  }

  /** A roar at the foot of each waterfall, placed in the world. */
  private buildFalls() {
    const ctx = this.ctx!;
    for (const f of this.falls) {
      for (const src of f.sources) src.stop();
      f.gain.disconnect();
      f.panner.disconnect();
    }
    this.falls = [];
    for (const w of this.world.waterfalls) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise.pink;
      src.loop = true;
      const low = ctx.createBufferSource();
      low.buffer = this.noise.brown;
      low.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pos = new THREE.Vector3(w.x + w.dirX * 8, w.top * 0.4, w.z + w.dirZ * 8);
      const panner = this.panner(pos.x, pos.y, pos.z, 14);
      src.connect(lp);
      low.connect(lp);
      lp.connect(gain).connect(panner);
      src.start(0, rand(0, 4));
      low.start(0, rand(0, 4));
      this.falls.push({ gain, panner, sources: [src, low], pos });
    }
  }

  private panner(x: number, y: number, z: number, ref: number, wet = 0.2) {
    const ctx = this.ctx!;
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1;
    p.maxDistance = 10000;
    p.positionX.value = x;
    p.positionY.value = y;
    p.positionZ.value = z;
    p.connect(this.master);
    if (wet > 0) {
      const send = ctx.createGain();
      send.gain.value = wet;
      p.connect(send).connect(this.reverb);
    }
    return p;
  }

  /** Samples the world around the listener: how near the sea and a river are, how wooded and how high it is. */
  private survey(p: THREE.Vector3) {
    const w = this.world;
    let sea = 1e9, forest = 0, n = 0;
    for (const r of [0, 15, 35, 70, 130, 220]) {
      const steps = r === 0 ? 1 : 10;
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
        const h = w.height(x, z);
        if (r < sea && h < -0.3 && w.riverEdge(x, z) > 3 && w.pondEdge(x, z) > 0) sea = r;
        if (r <= 35) (forest += w.forest(x, z)), n++;
      }
    }
    const ground = Math.max(w.height(p.x, p.z), 0);
    let pond: Place['pond'] = null;
    for (const q of w.ponds) {
      const d = Math.hypot(q.x - p.x, q.z - p.z) - q.radius;
      if (d < 140 && (!pond || d < pond.d)) pond = { x: q.x, z: q.z, d };
    }
    this.place = { sea, river: Math.max(w.riverEdge(p.x, p.z), 0), forest: forest / n, open: clamp01(ground / 45), pond };
  }

  update(f: SoundFrame) {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    if (!this.settings.on) {
      // Fade out, then suspend the context so the audio thread idles while muted.
      if (ctx.state === 'running') {
        this.master.gain.setTargetAtTime(0, now, 0.05);
        this.suspendAt ??= now + 0.3;
        if (now > this.suspendAt) void ctx.suspend();
      }
      return;
    }
    this.suspendAt = undefined;
    if (ctx.state === 'suspended') void ctx.resume();
    if (ctx.state !== 'running') return;
    // The slider's full scale is a gentle level: this is ambience, meant to sit under the scene.
    this.master.gain.setTargetAtTime(this.settings.volume * 0.5, now, 0.15);

    // The listener rides on the camera.
    const cam = f.camera;
    cam.getWorldPosition(this.v);
    cam.getWorldDirection(this.fwd);
    this.up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const L = ctx.listener;
    if (L.positionX) {
      L.positionX.value = this.v.x;
      L.positionY.value = this.v.y;
      L.positionZ.value = this.v.z;
      L.forwardX.value = this.fwd.x;
      L.forwardY.value = this.fwd.y;
      L.forwardZ.value = this.fwd.z;
      L.upX.value = this.up.x;
      L.upY.value = this.up.y;
      L.upZ.value = this.up.z;
    } else {
      // Older Firefox and Safari only have the setters.
      L.setPosition(this.v.x, this.v.y, this.v.z);
      L.setOrientation(this.fwd.x, this.fwd.y, this.fwd.z, this.up.x, this.up.y, this.up.z);
    }

    this.sinceSurvey += f.dt;
    if (this.sinceSurvey > 0.3) {
      this.sinceSurvey = 0;
      this.survey(this.v);
    }
    const P = this.place;
    const T = 0.4; // seconds: how quickly beds follow
    const night = 1 - f.daylight;
    const set = (b: Bed, g: number) => b.gain.gain.setTargetAtTime(g, now, T);

    // Wind: gusts like the ones bending the grass (same rhythm), stronger up high and in the open, hushed in woods.
    const t = performance.now() / 1000;
    const gust = 0.5 + 0.5 * Math.sin(this.v.x * 0.045 - t * 1.3) * Math.sin(this.v.x * 0.013 + this.v.z * 0.021 + t * 0.4);
    const windAmt = f.wind * (0.3 + 0.7 * gust) * (0.55 + 0.6 * P.open) * (1 - 0.45 * P.forest) * (1 + 0.6 * f.rain + 0.3 * f.snow);
    // Squared gust: the air goes nearly quiet between gusts instead of a constant roar.
    set(this.beds.wind, 0.11 * windAmt * gust * gust);
    this.beds.wind.filters[0].frequency.setTargetAtTime(260 + 380 * gust * Math.min(f.wind, 2), now, 0.5);
    set(this.beds.whistle, 0.05 * smooth(windAmt, 0.9, 1.8));
    this.beds.whistle.filters[0].frequency.setTargetAtTime(750 + 500 * gust, now, 0.6);
    set(this.beds.leaves, 0.035 * f.wind * gust * gust * smooth(P.forest, 0.15, 0.6));

    // Surf: a wave breaks every several seconds; the swell opens up bright and loud, then washes back.
    const seaNear = Math.pow(clamp01(1 - P.sea / 150), 2);
    if (now > this.nextWave) {
      const period = rand(5.5, 9);
      this.nextWave = now + period;
      const g = this.beds.surf.gain.gain, lp = this.beds.surf.filters[0].frequency;
      const peak = 0.4 * seaNear * rand(0.7, 1.1);
      g.cancelScheduledValues(now);
      g.setTargetAtTime(peak, now, 0.5);
      g.setTargetAtTime(peak * 0.3, now + 1.6, 1.4);
      lp.cancelScheduledValues(now);
      lp.setTargetAtTime(1800, now, 0.4);
      lp.setTargetAtTime(420, now + 1.4, 1.5);
    }

    // Rivers: babbling, the two bands nudged to new pitches and levels every moment.
    const riverNear = Math.pow(clamp01(1 - P.river / 45), 2);
    if (now > this.nextBabble) {
      this.nextBabble = now + rand(0.06, 0.16);
      this.beds.river.filters[0].frequency.setTargetAtTime(rand(900, 1700), now, 0.05);
      this.beds.river.filters[1].frequency.setTargetAtTime(rand(2300, 3600), now, 0.05);
      this.beds.river.gain.gain.setTargetAtTime(0.22 * riverNear * rand(0.6, 1), now, 0.05);
    }

    // Rain on the ground, and on the leaves overhead in the woods; drips under the trees after.
    set(this.beds.rain, 0.22 * f.rain);
    set(this.beds.patter, 0.1 * f.rain * smooth(P.forest, 0.1, 0.6));
    if (f.rain > 0.05 && P.forest > 0.2 && now > this.nextDrip) {
      this.nextDrip = now + rand(0.05, 0.5) / f.rain;
      this.drip(now);
    }

    // Snow hushes everything a little.
    this.muffle.frequency.setTargetAtTime(18000 - 12000 * f.snowCover, now, 1);

    // The torch: a breathy flame and crackles, sometimes a pop.
    set(this.beds.torch, f.torch ? 0.06 : 0);
    if (f.torch && now > this.nextCrackle) {
      this.nextCrackle = now + Math.min(-Math.log(Math.random()) * 0.12, 0.8);
      this.crackle(now, Math.random() < 0.08 ? 0.5 : rand(0.06, 0.2));
    }

    // Waterfalls: the panners place them; the roar fades out entirely by ~200 m (an inverse falloff alone never
    // reaches silence, and left a hiss everywhere).
    for (const fall of this.falls) fall.gain.gain.setTargetAtTime(0.9 * (1 - smooth(fall.pos.distanceTo(this.v), 60, 200)), now, 0.3);

    // Crickets: summer evenings and nights in the open (not in the rain or snow, quieter in the woods).
    const cricketAmt = smooth(night, 0.35, 0.8) * (1 - 0.8 * P.forest) * (1 - f.rain) * (1 - f.snowCover) * (1 - smooth(f.wind, 1.5, 3));
    for (const c of this.crickets) {
      if (cricketAmt < 0.02) {
        c.next = now + rand(0, 1);
        continue;
      }
      while (c.next < now + 0.4) {
        // A chirp: three or four quick pulses.
        const pulses = Math.random() < 0.5 ? 3 : 4;
        for (let i = 0; i < pulses; i++) {
          const s = c.next + i * 0.034;
          c.gain.gain.setValueAtTime(0, s);
          c.gain.gain.linearRampToValueAtTime(c.amp * cricketAmt, s + 0.006);
          c.gain.gain.linearRampToValueAtTime(0, s + 0.02);
        }
        c.next += c.period * rand(0.92, 1.08) + (Math.random() < 0.08 ? rand(0.5, 2) : 0);
      }
    }

    // Birds by day: a dawn chorus, steady song through the day, a few at dusk; few in rain or snow.
    const dawn = smooth(f.hours, 4.3, 5.5) * (1 - smooth(f.hours, 7.5, 9.5));
    const birdRate = (f.daylight * (0.35 + 1.4 * dawn) + 0.1 * smooth(f.daylight, 0.05, 0.3)) * (1 - 0.8 * f.rain) * (1 - 0.6 * f.snow);
    if (now > this.nextBird) {
      // Sparse: a song now and then, not a constant chorus.
      this.nextBird = now + (birdRate > 0.02 ? rand(4, 12) / birdRate : 3);
      if (birdRate > 0.02) this.bird(now, P.forest, f.daylight, P.sea);
    }

    // Owls at night, from the woods.
    if (now > this.nextOwl) {
      this.nextOwl = now + rand(12, 30);
      if (night > 0.75 && P.forest > 0.15 && f.rain < 0.3) this.owl(now);
    }

    // Frogs at the nearest pond: a chorus at dusk and through the night, now and then by day.
    if (P.pond && now > this.nextFrog) {
      const frogAmt = (0.25 + 0.75 * smooth(night, 0.2, 0.7)) * (1 - f.snowCover);
      this.nextFrog = now + rand(0.4, 3) / Math.max(frogAmt, 0.05) * (1 + P.pond.d / 60);
      if (frogAmt > 0.05) this.frog(now, P.pond, frogAmt);
    }

    this.footsteps(f, now);
  }

  // --- One-shot voices ---------------------------------------------------------------------------------------------

  /** A filtered noise burst with an attack/decay envelope, optionally at a point in the world. */
  private burst(at: number, o: { dur: number; type: BiquadFilterType; freq: number; q?: number; gain: number; attack?: number; to?: AudioNode; sweep?: number }) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise.white;
    const bq = ctx.createBiquadFilter();
    bq.type = o.type;
    bq.frequency.setValueAtTime(o.freq, at);
    if (o.sweep) bq.frequency.exponentialRampToValueAtTime(o.sweep, at + o.dur);
    bq.Q.value = o.q ?? 0.8;
    const g = ctx.createGain();
    const a = o.attack ?? 0.003;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(o.gain, at + a);
    g.gain.exponentialRampToValueAtTime(0.0001, at + o.dur);
    src.connect(bq).connect(g).connect(o.to ?? this.master);
    src.start(at, rand(0, 4), o.dur + 0.05);
    src.onended = () => g.disconnect();
  }

  private crackle(at: number, level: number) {
    this.burst(at, { dur: rand(0.008, 0.04), type: 'highpass', freq: rand(1800, 5000), q: 0.7, gain: level * 0.5 });
    if (level > 0.3) this.burst(at, { dur: 0.09, type: 'bandpass', freq: 700, q: 1, gain: level * 0.4 });
  }

  private drip(at: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const f0 = rand(1400, 3200);
    osc.frequency.setValueAtTime(f0, at);
    osc.frequency.exponentialRampToValueAtTime(f0 * 1.6, at + 0.03);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(rand(0.01, 0.035), at + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    const pan = ctx.createStereoPanner();
    pan.pan.value = rand(-1, 1);
    osc.connect(g).connect(pan).connect(this.master);
    osc.start(at);
    osc.stop(at + 0.07);
    osc.onended = () => pan.disconnect();
  }

  /**
   * One oscillator sung through a gain gate: each note sets the pitch (with a glide) and opens the gate. Placed at
   * a point in the world with some reverb. Returns the end time.
   */
  private phrase(
    at: number,
    pos: THREE.Vector3,
    notes: { t: number; dur: number; f0: number; f1: number; amp: number }[],
    o: { type?: OscillatorType; vibrato?: [number, number]; ref?: number; wet?: number; lowpass?: number; harmonic?: number } = {},
  ) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    const g = ctx.createGain();
    g.gain.value = 0;
    let end = at;
    for (const n of notes) {
      const s = at + n.t, e = s + n.dur;
      const atk = Math.min(0.012, n.dur * 0.3), rel = Math.min(0.03, n.dur * 0.4);
      osc.frequency.setValueAtTime(n.f0, s);
      osc.frequency.exponentialRampToValueAtTime(n.f1, e);
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(n.amp, s + atk);
      g.gain.setValueAtTime(n.amp, e - rel);
      g.gain.linearRampToValueAtTime(0, e);
      end = Math.max(end, e);
    }
    const panner = this.panner(pos.x, pos.y, pos.z, o.ref ?? 8, o.wet ?? 0.25);
    let out: AudioNode = g;
    if (o.lowpass) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = o.lowpass;
      out = out.connect(lp);
    }
    osc.connect(g);
    out.connect(panner);
    const nodes: AudioScheduledSourceNode[] = [osc];
    if (o.vibrato) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = o.vibrato[0];
      const depth = ctx.createGain();
      depth.gain.value = o.vibrato[1];
      lfo.connect(depth).connect(osc.frequency);
      nodes.push(lfo);
    }
    if (o.harmonic) {
      // A quieter octave above, for a reedier, richer tone.
      const h = ctx.createOscillator();
      for (const n of notes) {
        h.frequency.setValueAtTime(n.f0 * 2, at + n.t);
        h.frequency.exponentialRampToValueAtTime(n.f1 * 2, at + n.t + n.dur);
      }
      const hg = ctx.createGain();
      hg.gain.value = o.harmonic;
      h.connect(hg).connect(g);
      nodes.push(h);
    }
    for (const n of nodes) {
      n.start(at);
      n.stop(end + 0.1);
    }
    osc.onended = () => panner.disconnect();
    return end;
  }

  /** Somewhere around the listener, up in the trees or the sky. */
  private around(minR: number, maxR: number, up: [number, number]) {
    const a = Math.random() * Math.PI * 2, r = rand(minR, maxR);
    const x = this.v.x + Math.cos(a) * r, z = this.v.z + Math.sin(a) * r;
    return new THREE.Vector3(x, Math.max(this.world.height(x, z), 0) + rand(up[0], up[1]), z);
  }

  private bird(at: number, forest: number, daylight: number, sea: number) {
    const r = Math.random();
    const woods = forest > 0.25;
    // By the sea: gulls wheeling over the shore, a few mewing "kee-ow" calls.
    if (sea < 80 && r < 0.6) {
      const pos = this.around(25, 70, [12, 30]);
      const calls = 1 + Math.floor(Math.random() * 3);
      const notes = [];
      for (let i = 0; i < calls; i++) {
        const t = i * rand(0.35, 0.5), f = rand(950, 1250);
        notes.push({ t, dur: 0.09, f0: f, f1: f * 1.35, amp: 0.12 }, { t: t + 0.09, dur: 0.22, f0: f * 1.35, f1: f * 0.8, amp: 0.14 });
      }
      this.phrase(at, pos, notes, { type: 'sawtooth', lowpass: 2400, ref: 14, wet: 0.15 });
      return;
    }
    // Over open meadow on a fine day: a skylark pouring out song high overhead.
    if (!woods && daylight > 0.6 && r < 0.12) {
      const notes = [];
      let t = 0;
      const len = rand(3, 6);
      while (t < len) {
        const d = rand(0.04, 0.11), f = rand(2600, 5200);
        notes.push({ t, dur: d, f0: f, f1: f * rand(0.85, 1.2), amp: rand(0.05, 0.1) });
        t += d + rand(0.005, 0.03);
      }
      this.phrase(at, this.around(20, 50, [25, 45]), notes, { ref: 20, wet: 0.1 });
      return;
    }
    // A woodpecker drumming on a trunk.
    if (woods && r < 0.1) {
      const pos = this.around(25, 70, [4, 10]);
      const panner = this.panner(pos.x, pos.y, pos.z, 6, 0.4);
      const n = 12 + Math.floor(Math.random() * 10);
      for (let i = 0; i < n; i++) this.burst(at + i * 0.055 * (1 + i * 0.01), { dur: 0.03, type: 'bandpass', freq: 1100, q: 3, gain: 0.5 * (1 - i / (n * 1.4)), to: panner });
      setTimeout(() => panner.disconnect(), (n * 0.07 + 3) * 1000);
      return;
    }
    const pos = this.around(10, woods ? 45 : 35, woods ? [4, 14] : [1, 5]);
    const kind = pick(['warble', 'trill', 'flute', 'chirps'] as const);
    const notes: { t: number; dur: number; f0: number; f1: number; amp: number }[] = [];
    let t = 0;
    if (kind === 'warble') {
      // Robin-like: tumbling high notes, each sliding a different way.
      const n = 6 + Math.floor(Math.random() * 7);
      for (let i = 0; i < n; i++) {
        const d = rand(0.05, 0.14), f = rand(2400, 4600);
        notes.push({ t, dur: d, f0: f, f1: f * rand(0.75, 1.3), amp: rand(0.06, 0.12) });
        t += d + rand(0.02, 0.07);
      }
    } else if (kind === 'trill') {
      // Chaffinch-like: a run of quick notes falling and speeding up, ending in a flourish.
      const n = 9 + Math.floor(Math.random() * 6);
      let f = rand(4800, 5600), gap = 0.075;
      for (let i = 0; i < n; i++) {
        notes.push({ t, dur: 0.035, f0: f, f1: f * 0.88, amp: 0.09 });
        t += 0.035 + gap;
        f *= 0.975;
        gap *= 0.94;
      }
      notes.push({ t: t + 0.02, dur: 0.18, f0: f * 1.25, f1: f * 0.75, amp: 0.11 });
    } else if (kind === 'flute') {
      // Blackbird-like: a few low, fluting notes with a little vibrato.
      const n = 3 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const d = rand(0.15, 0.36), f = rand(1500, 2700);
        notes.push({ t, dur: d, f0: f, f1: f * rand(0.85, 1.15), amp: rand(0.08, 0.14) });
        t += d + rand(0.04, 0.12);
      }
      this.phrase(at, pos, notes, { vibrato: [rand(18, 28), 40], ref: 10, wet: 0.35, harmonic: 0.12 });
      return;
    } else {
      // Sparrow-ish chirps: a couple of short bright notes.
      const n = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < n; i++) {
        const f = rand(3000, 4200);
        notes.push({ t, dur: 0.06, f0: f * 1.1, f1: f * 0.8, amp: 0.08 });
        t += rand(0.12, 0.3);
      }
    }
    this.phrase(at, pos, notes, { ref: 10, wet: 0.3 });
  }

  /** A tawny owl from the dark woods: a long hoot, a pause, then a wavering "hu-hu-hoooo". */
  private owl(at: number) {
    const pos = this.around(45, 110, [6, 14]);
    const f = rand(370, 420);
    this.phrase(
      at,
      pos,
      [
        { t: 0, dur: 0.55, f0: f, f1: f * 0.95, amp: 0.4 },
        { t: 1.6, dur: 0.12, f0: f * 1.05, f1: f, amp: 0.25 },
        { t: 1.82, dur: 0.12, f0: f * 1.05, f1: f, amp: 0.25 },
        { t: 2.05, dur: 0.8, f0: f * 1.08, f1: f * 0.92, amp: 0.38 },
      ],
      { vibrato: [7, 6], ref: 14, wet: 0.7, lowpass: 900, harmonic: 0.05 },
    );
  }

  /** A frog at the pond's edge: a burst of quick pulses through a throaty resonance. */
  private frog(at: number, pond: { x: number; z: number; d: number }, amt: number) {
    const ctx = this.ctx!;
    const q = this.world.ponds.find((p) => p.x === pond.x && p.z === pond.z);
    const a = Math.random() * Math.PI * 2, r = (q?.radius ?? 6) * rand(0.9, 1.2);
    const x = pond.x + Math.cos(a) * r, z = pond.z + Math.sin(a) * r;
    const panner = this.panner(x, Math.max(this.world.height(x, z), 0) + 0.2, z, 5, 0.25);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const f = rand(85, 140);
    osc.frequency.setValueAtTime(f, at);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = rand(450, 900);
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.value = 0;
    // "Rib-bit": two groups of pulses, the second a touch higher.
    const groups = Math.random() < 0.6 ? 2 : 1;
    let t = at;
    for (let k = 0; k < groups; k++) {
      const pulses = 5 + Math.floor(Math.random() * 6), rate = rand(14, 20);
      if (k) osc.frequency.setValueAtTime(f * 1.15, t);
      for (let i = 0; i < pulses; i++) {
        const s = t + i / rate;
        g.gain.setValueAtTime(0, s);
        g.gain.linearRampToValueAtTime(0.4 * amt, s + 0.008);
        g.gain.linearRampToValueAtTime(0, s + 0.6 / rate);
      }
      t += pulses / rate + 0.09;
    }
    osc.connect(bp).connect(g).connect(panner);
    osc.start(at);
    osc.stop(t + 0.05);
    osc.onended = () => panner.disconnect();
  }

  // --- Footsteps ---------------------------------------------------------------------------------------------------

  private surface(x: number, z: number, snowCover: number): Surface {
    const w = this.world;
    const h = w.height(x, z);
    if (h < 0.15 || w.pondEdge(x, z) < 0.2) return 'water';
    if (snowCover > 0.35) return 'snow';
    const slope = Math.hypot(w.height(x + 1, z) - w.height(x - 1, z), w.height(x, z + 1) - w.height(x, z - 1)) / 2;
    if (slope > 0.55) return 'stone';
    if (h < 2.6) return w.riverEdge(x, z) < 8 ? 'stone' : 'sand';
    if (w.forest(x, z) > 0.45) return 'leaves';
    if (w.dirt(x, z) > 0.5) return 'dirt';
    return 'grass';
  }

  private footsteps(f: SoundFrame, now: number) {
    const moved = Math.hypot(f.feet.x - this.lastFeet.x, f.feet.z - this.lastFeet.z);
    this.lastFeet.copy(f.feet);
    const landed = f.grounded && !this.wasGrounded;
    this.wasGrounded = f.grounded;
    // Teleports (map travel, regenerate) aren't steps.
    if (!f.grounded || moved > 3) {
      this.stride = 0;
      return;
    }
    const speed = moved / Math.max(f.dt, 1e-3);
    const surface = this.surface(f.feet.x, f.feet.z, f.snowCover);
    const force = speed > 6 ? 1.25 : 1;
    if (landed) this.step(now, surface, 1.6);
    else if (f.footfalls !== null) {
      // In step with the character's legs.
      for (let i = 0; i < Math.min(f.footfalls, 2); i++) this.step(now + i * 0.05, surface, force);
    } else {
      // No body to watch: a natural cadence, quicker strides the faster you go (two to three steps a second).
      this.stride += moved / Math.max(speed / (1.9 + 0.12 * Math.min(speed, 10)), 0.3);
      if (this.stride >= 1) {
        this.stride -= Math.floor(this.stride);
        this.step(now, surface, force);
      }
    }
  }

  private step(at: number, s: Surface, force: number) {
    const k = force * rand(0.8, 1.1);
    const thud = (freq: number, gain: number) => {
      const ctx = this.ctx!;
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(freq, at);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.6, at + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(gain, at + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
      osc.connect(g).connect(this.master);
      osc.start(at);
      osc.stop(at + 0.1);
      osc.onended = () => g.disconnect();
    };
    /** A few grains of noise close together: crunch. */
    const grains = (n: number, span: number, o: Parameters<Soundscape['burst']>[1]) => {
      for (let i = 0; i < n; i++) this.burst(at + Math.random() * span, { ...o, gain: o.gain * rand(0.5, 1) });
    };
    switch (s) {
      case 'grass':
        this.burst(at, { dur: 0.13, type: 'bandpass', freq: rand(2200, 3200), q: 0.7, gain: 0.07 * k, attack: 0.02 });
        thud(80, 0.08 * k);
        break;
      case 'leaves':
        grains(6, 0.09, { dur: 0.03, type: 'bandpass', freq: rand(2500, 4200), q: 0.9, gain: 0.07 * k });
        thud(75, 0.08 * k);
        break;
      case 'dirt':
        this.burst(at, { dur: 0.09, type: 'lowpass', freq: 1500, q: 0.7, gain: 0.08 * k, attack: 0.006 });
        thud(70, 0.1 * k);
        break;
      case 'sand':
        grains(5, 0.1, { dur: 0.06, type: 'bandpass', freq: rand(1100, 1700), q: 0.8, gain: 0.06 * k, attack: 0.008 });
        break;
      case 'snow':
        grains(8, 0.12, { dur: 0.035, type: 'bandpass', freq: rand(1300, 2100), q: 1.6, gain: 0.07 * k });
        thud(65, 0.05 * k);
        break;
      case 'stone':
        this.burst(at, { dur: 0.025, type: 'highpass', freq: 2500, q: 0.7, gain: 0.07 * k });
        thud(120, 0.12 * k);
        break;
      case 'water':
        this.burst(at, { dur: 0.22, type: 'bandpass', freq: 900, sweep: 2600, q: 0.8, gain: 0.12 * k, attack: 0.01 });
        for (let i = 0; i < 3; i++) this.drip(at + rand(0.03, 0.18));
        break;
    }
  }
}
