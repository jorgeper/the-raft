// Real-time pass that records the synthesized soundscape and a log mapping audio-context time to film time.
// Film time is driven by the audio clock, so hitches can't make sound and picture drift. Needs `npx vite` running.
import { chromium } from 'playwright';
import fs from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const LIMIT = +arg('seconds', 0);

const tap = () => {
  const worklet = `class Tap extends AudioWorkletProcessor {
    constructor() { super(); this.n = 0; this.L = new Float32Array(8192); this.R = new Float32Array(8192); this.t = 0; }
    process(inputs) {
      const ch = inputs[0];
      if (this.n === 0) this.t = currentTime;
      const l = ch[0] || new Float32Array(128), r = ch[1] || l;
      this.L.set(l, this.n); this.R.set(r, this.n); this.n += 128;
      if (this.n >= 8192) { this.port.postMessage({ t: this.t, L: this.L, R: this.R }); this.L = new Float32Array(8192); this.R = new Float32Array(8192); this.n = 0; }
      return true;
    }
  } registerProcessor('tap', Tap);`;
  const url = URL.createObjectURL(new Blob([worklet], { type: 'application/javascript' }));
  window.__rec = { chunks: [], rate: 0, ready: false };
  const orig = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (dest, ...rest) {
    const r = orig.call(this, dest, ...rest);
    if (dest instanceof AudioDestinationNode && !this.__tapped) {
      this.__tapped = true;
      const ctx = this.context, src = this;
      window.__rec.rate = ctx.sampleRate;
      ctx.audioWorklet.addModule(url).then(() => {
        const node = new AudioWorkletNode(ctx, 'tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 2, channelCountMode: 'explicit' });
        node.port.onmessage = (e) => {
          const { t, L, R } = e.data, pcm = new Float32Array(L.length * 2);
          for (let i = 0; i < L.length; i++) { pcm[2 * i] = L[i]; pcm[2 * i + 1] = R[i]; }
          window.__rec.chunks.push({ t, pcm });
        };
        const mute = new GainNode(ctx, { gain: 0 });
        orig.call(src, node);
        orig.call(node, mute);
        orig.call(mute, ctx.destination);
        window.__rec.ready = true;
      });
    }
    return r;
  };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-size=960,540'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(tap);
await page.goto('http://localhost:5173/?defaults&view=first', { waitUntil: 'load' });
await page.waitForFunction(() => window.__app, null, { timeout: 120000 });
await page.evaluate(() => { __app.display.quality = 'low'; __app.applyQuality(); __app.sound.settings.volume = 1; __app.sound.unlock(); });
await page.waitForFunction(() => window.__rec.ready, null, { timeout: 30000 });
await page.waitForTimeout(8000);
const meta = await page.evaluate(() => {
  const d = __app.demo, ctx = __app.sound.ctx;
  window.__log = [];
  const u = d.update.bind(d);
  // Film time follows the audio clock, so hitches can't make the two drift apart.
  let last = null;
  d.update = (dt, eye) => {
    const now = ctx.currentTime, step = last === null ? 0 : now - last;
    last = now;
    const r = u(step, eye);
    window.__log.push([now, d.index, d.shotTime, step]);
    return r;
  };
  __app.startDemo();
  return { starts: d.starts, duration: d.duration, rate: window.__rec.rate, state: ctx.state };
});
console.log(meta);
fs.mkdirSync('recordings', { recursive: true });
const out = fs.openSync('recordings/audio.raw', 'w');
const chunkTimes = [];
const pull = async () => {
  const got = await page.evaluate(() => {
    const c = window.__rec.chunks; window.__rec.chunks = [];
    return c.map(({ t, pcm }) => { const u8 = new Uint8Array(pcm.buffer); let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192)); return { t, b: btoa(s) }; });
  });
  for (const { t, b } of got) { chunkTimes.push(t); fs.writeSync(out, Buffer.from(b, 'base64')); }
};
const t0 = Date.now();
while (await page.evaluate(() => __app.demo.active)) {
  await page.waitForTimeout(1000);
  await pull();
  if (LIMIT && (Date.now() - t0) / 1000 > LIMIT) break;
}
await page.waitForTimeout(500);
await pull();
const log = await page.evaluate(() => window.__log);
fs.closeSync(out);
fs.writeFileSync('recordings/audio-meta.json', JSON.stringify({ ...meta, chunkTimes, chunkFrames: 8192, log }));
console.log('chunks', chunkTimes.length, 'log', log.length, 'max dt', Math.max(...log.map((l) => l[3])));
await browser.close();
