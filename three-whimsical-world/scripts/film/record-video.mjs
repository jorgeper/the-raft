// Offline render of the demo film: virtual clock, one exact 1/fps step per frame, screenshot piped into ffmpeg.
// Needs `npx vite` running and Google Chrome installed. node scripts/film/record-video.mjs [--from shotIndex] [--to shotIndex(exclusive)] [--test frames] [--fps 60] [--w 1920 --h 1080]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const FPS = +arg('fps', 60), W = +arg('w', 1920), H = +arg('h', 1080), QUALITY = arg('quality', 'ultra');
const OUT = arg('out', 'recordings/segs'); fs.mkdirSync(OUT, { recursive: true });
const TEST = arg('test', null);

const shim = () => {
  const realNow = performance.now.bind(performance);
  const realRAF = window.requestAnimationFrame.bind(window);
  let virtual = false, vnow = 0, lastTs = 0, queue = [], id = 1;
  performance.now = () => (virtual ? vnow : realNow());
  window.requestAnimationFrame = (cb) => {
    if (virtual) { queue.push([id, cb]); return id++; }
    return realRAF((ts) => { lastTs = ts; cb(ts); });
  };
  const realCancel = window.cancelAnimationFrame.bind(window);
  window.cancelAnimationFrame = (h) => { queue = queue.filter(([i]) => i !== h); realCancel(h); };
  window.__virt = {
    // Freeze the clock at the last real frame; from now on frames only happen through step().
    start() { virtual = true; vnow = lastTs || realNow(); return vnow; },
    step(t) { vnow = t; const q = queue; queue = []; for (const [, cb] of q) cb(vnow); return q.length; },
  };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', `--window-size=${W},${H}`] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || /Shader Error/.test(m.text())) console.log('console:', m.text().slice(0, 300), m.location().url); });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('response', (r) => { if (r.status() >= 400) console.log('http', r.status(), r.url()); });
await page.addInitScript(shim);
await page.goto('http://localhost:5173/?defaults&view=first', { waitUntil: 'load' });
await page.waitForFunction(() => window.__app, null, { timeout: 120000 });
await page.evaluate((q) => { __app.display.quality = q; __app.applyQuality(); }, QUALITY);
await page.waitForTimeout(8000); // let workers, textures and models settle
const starts = await page.evaluate(() => { __app.startDemo(); return __app.demo.starts; });
const total = await page.evaluate(() => __app.demo.duration);
const from = +arg('from', 0), to = +arg('to', starts.length);
const t0v = await page.evaluate(() => window.__virt.start());
if (from > 0) await page.evaluate((s) => __app.demo.seek(s), starts[from]);
const cdp = await page.context().newCDPSession(page);
const bounds = [...starts, total];
console.log(`film ${total}s, shots ${starts.length}, rendering ${from}..${to - 1} at ${W}x${H}@${FPS} ${QUALITY}`);

let frame = Math.round(starts[from] * FPS);
const t0 = Date.now();
for (let s = from; s < to; s++) {
  const end = TEST ? frame + +TEST : Math.round(bounds[s + 1] * FPS);
  const file = `${OUT}/shot${String(s).padStart(2, '0')}.mp4`;
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-r', String(FPS), file + '.part.mp4'], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((r) => ff.on('close', r));
  let local = 0;
  for (; frame < end; frame++, local++) {
    // Frame n shows film time n/FPS: the first step after start() is frame 0 + 1/FPS of real time.
    await page.evaluate(([v]) => window.__virt.step(v), [t0v + ((frame - Math.round(starts[from] * FPS)) + 1) * (1000 / FPS)]);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: true, clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
    const buf = Buffer.from(data, 'base64');
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (TEST && local < 3) fs.writeFileSync(`recordings/test-${s}-${local}.jpg`, buf);
    if (frame % 120 === 0) {
      const el = (Date.now() - t0) / 1000, n = frame - Math.round(starts[from] * FPS) + 1;
      console.log(`shot ${s} frame ${frame}/${Math.round(total * FPS)}  ${(el / n).toFixed(3)} s/frame  elapsed ${(el / 60).toFixed(1)} min`);
    }
  }
  ff.stdin.end();
  await done;
  fs.renameSync(file + '.part.mp4', file);
  console.log(`wrote ${file}`);
  if (TEST) break;
}
await browser.close();
