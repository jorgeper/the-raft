// All-WebAudio slapstick sound (spec §8). No audio files.
export function createAudio() {
  let ctx = null;
  let master = null;
  let windNode = null, windGain = null;
  let muted = false;
  try { muted = localStorage.getItem('downhill-madness-muted') === '1'; } catch { /* ok */ }

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.55;
      master.connect(ctx.destination);
      startWind();
      scheduleBirds();
    } catch { return false; }
    return true;
  }

  const noiseBuffer = () => {
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  };

  let _noise = null;
  function noise() { return (_noise ||= noiseBuffer()); }

  function env(node, t0, a, peak, d, end = 0.0001) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.linearRampToValueAtTime(peak, t0 + a);
    node.gain.exponentialRampToValueAtTime(end, t0 + a + d);
  }

  function blip({ type = 'sine', f0 = 440, f1 = f0, dur = 0.15, vol = 0.3, delay = 0 }) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    env(g, t, 0.008, vol, dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function thump({ vol = 0.5, dur = 0.09, freq = 900, delay = 0 }) {
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noise();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq;
    const g = ctx.createGain();
    env(g, t, 0.004, vol, dur);
    src.connect(f).connect(g).connect(master);
    src.start(t); src.stop(t + dur + 0.1);
  }

  function startWind() {
    windNode = ctx.createBufferSource();
    windNode.buffer = noise();
    windNode.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 320; f.Q.value = 0.6;
    windGain = ctx.createGain();
    windGain.gain.value = 0;
    windNode.connect(f).connect(windGain).connect(master);
    windNode.start();
  }

  let birdTimer = null;
  function scheduleBirds() {
    const chirp = () => {
      if (ctx && ctx.state === 'running') {
        const n = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < n; i++) {
          blip({ type: 'sine', f0: 2400 + Math.random() * 1600, f1: 1900 + Math.random() * 900, dur: 0.06 + Math.random() * 0.05, vol: 0.045, delay: i * 0.09 });
        }
      }
      birdTimer = setTimeout(chirp, 1500 + Math.random() * 5000);
    };
    chirp();
  }

  return {
    ensure,
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.55;
      try { localStorage.setItem('downhill-madness-muted', muted ? '1' : '0'); } catch { /* ok */ }
      return muted;
    },
    isMuted: () => muted,
    setWind(level) { if (windGain) windGain.gain.value = 0.12 * level; },
    footstep(desperation) {
      thump({ vol: 0.1 + desperation * 0.08, dur: 0.05, freq: 500 + desperation * 500 });
      if (Math.random() < 0.06) blip({ type: 'triangle', f0: 900, f1: 1400, dur: 0.05, vol: 0.03 }); // squeak
    },
    jump() { blip({ type: 'sine', f0: 300, f1: 760, dur: 0.22, vol: 0.22 }); }, // cartoon boing
    bigJump() { blip({ type: 'sine', f0: 220, f1: 900, dur: 0.4, vol: 0.3 }); },
    land() { thump({ vol: 0.35, freq: 700 }); },
    nearMiss() { blip({ type: 'sawtooth', f0: 1800, f1: 300, dur: 0.1, vol: 0.07 }); }, // whip
    stumble() {
      thump({ vol: 0.4, freq: 800 });
      blip({ type: 'square', f0: 520, f1: 180, dur: 0.18, vol: 0.1, delay: 0.03 }); // "whuh!"
    },
    spin() { blip({ type: 'sine', f0: 500, f1: 1100, dur: 0.5, vol: 0.12 }); },
    score(big = false) { blip({ type: 'triangle', f0: big ? 900 : 700, f1: big ? 1500 : 1050, dur: 0.14, vol: 0.12 }); },
    bleat() { blip({ type: 'sawtooth', f0: 620, f1: 540, dur: 0.28, vol: 0.1 }); blip({ type: 'sawtooth', f0: 700, f1: 560, dur: 0.2, vol: 0.08, delay: 0.12 }); },
    moo() { blip({ type: 'sawtooth', f0: 190, f1: 120, dur: 0.7, vol: 0.14 }); },
    bell() { blip({ type: 'triangle', f0: 2100, f1: 2100, dur: 0.25, vol: 0.12 }); blip({ type: 'triangle', f0: 2100, f1: 2100, dur: 0.25, vol: 0.1, delay: 0.18 }); },
    cluck() { blip({ type: 'square', f0: 800, f1: 1300, dur: 0.06, vol: 0.06 }); },
    buzz(on) {
      // handled as a blip loop for simplicity
      if (on) blip({ type: 'sawtooth', f0: 210, f1: 190, dur: 0.9, vol: 0.09 });
    },
    creak() { blip({ type: 'sawtooth', f0: 90, f1: 55, dur: 1.0, vol: 0.16 }); },
    crack() { thump({ vol: 0.6, freq: 2200, dur: 0.2 }); thump({ vol: 0.5, freq: 500, dur: 0.4, delay: 0.08 }); },
    splash() { thump({ vol: 0.3, freq: 3000, dur: 0.3 }); },
    crash() {
      // comedic yelp + tumbling thumps
      blip({ type: 'square', f0: 800, f1: 240, dur: 0.4, vol: 0.2 });
      for (let i = 0; i < 5; i++) thump({ vol: 0.4 - i * 0.06, freq: 900 - i * 120, dur: 0.1, delay: 0.15 + i * 0.17 });
    },
    endBirds() {
      for (let i = 0; i < 6; i++) {
        blip({ type: 'sine', f0: 2600 + (i % 3) * 500, f1: 2100 + (i % 2) * 400, dur: 0.09, vol: 0.05, delay: 0.4 + i * 0.16 });
      }
    },
    dispose() { if (birdTimer) clearTimeout(birdTimer); },
  };
}
