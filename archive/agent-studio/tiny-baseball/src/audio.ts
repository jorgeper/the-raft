/**
 * SPEC §5.3 / constraints — every sound is synthesized with WebAudio at
 * runtime; no audio files, no remote assets. Context is created lazily on the
 * first user gesture (browser autoplay policy).
 */
export interface Sound {
  crack(): void;
  pop(): void;
  cheer(big: boolean): void;
  setMuted(muted: boolean): void;
  /** Must be called from a user-gesture handler at least once. */
  unlock(): void;
}

export function buildSound(initialMuted: boolean): Sound {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let murmur: AudioBufferSourceNode | null = null;
  let muted = initialMuted;

  function ensure(): AudioContext | null {
    if (ctx) return ctx;
    if (typeof AudioContext === 'undefined') return null;
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    startMurmur();
    return ctx;
  }

  function noiseBuffer(seconds: number): AudioBuffer {
    const c = ctx!;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      // brown-ish noise: integrate white noise for a soft rumble
      last = (last + (Math.random() * 2 - 1) * 0.02) * 0.998;
      d[i] = last * 6;
    }
    return buf;
  }

  /** Continuous soft crowd murmur, looped (SPEC §5.3). */
  function startMurmur(): void {
    const c = ctx!;
    murmur = c.createBufferSource();
    murmur.buffer = noiseBuffer(2.5);
    murmur.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = c.createGain();
    g.gain.value = 0.05;
    murmur.connect(lp).connect(g).connect(master!);
    murmur.start();
  }

  /** Short filtered-noise swell — the crowd roar. */
  function roar(duration: number, peak: number): void {
    const c = ensure();
    if (!c || !master) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(duration);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + duration * 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    src.connect(bp).connect(g).connect(master);
    src.start();
    src.stop(t + duration);
  }

  function blip(freq: number, duration: number, type: OscillatorType, gain: number): void {
    const c = ensure();
    if (!c || !master) return;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = c.createGain();
    const t = c.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + duration);
    o.connect(g).connect(master);
    o.start();
    o.stop(t + duration);
  }

  return {
    crack() {
      blip(180, 0.08, 'square', 0.5);
      roar(0.25, 0.18);
    },
    pop() {
      blip(340, 0.05, 'triangle', 0.35);
    },
    cheer(big) {
      roar(big ? 2.2 : 1.0, big ? 0.6 : 0.35);
      if (big) {
        blip(523, 0.35, 'square', 0.12);
        setTimeout(() => blip(659, 0.35, 'square', 0.12), 180);
        setTimeout(() => blip(784, 0.5, 'square', 0.12), 360);
      }
    },
    setMuted(m) {
      muted = m;
      if (master) master.gain.value = m ? 0 : 1;
    },
    unlock() {
      const c = ensure();
      if (c && c.state === 'suspended') void c.resume();
    },
  };
}
