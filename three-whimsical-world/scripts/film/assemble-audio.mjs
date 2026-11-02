// Lays the recorded soundscape onto the film's timeline, shot by shot, and writes a float WAV.
import fs from 'node:fs';
const m = JSON.parse(fs.readFileSync('recordings/audio-meta.json', 'utf8'));
const sr = m.rate, N = m.chunkFrames;
const raw = new Float32Array(fs.readFileSync('recordings/audio.raw').buffer.slice(0));
const base = m.chunkTimes[0];
const absLen = Math.round((m.chunkTimes.at(-1) - base) * sr) + N;
const abs = new Float32Array(absLen * 2);
let prevEnd = 0, gaps = [];
m.chunkTimes.forEach((t, j) => {
  const at = Math.round((t - base) * sr);
  if (at > prevEnd + 1) {
    gaps.push({ ctx: t, ms: ((at - prevEnd) / sr) * 1000 });
    // Fill the hole with the audio just before it (noise beds, so it doesn't show).
    for (let i = prevEnd; i < at; i++) for (let c = 0; c < 2; c++) abs[2 * i + c] = abs[2 * (i - (at - prevEnd)) + c] ?? 0;
  }
  abs.set(raw.subarray(j * N * 2, (j + 1) * N * 2), at * 2);
  prevEnd = at + N;
});
const by = {};
for (const [c, i, s] of m.log) if (s > 0.05) (by[i] ??= []).push(c - s);
const offsets = m.starts.map((_, k) => { const v = (by[k] ?? []).sort((a, b) => a - b); return v[v.length >> 1]; });
console.log('gaps', gaps.map((g) => `${g.ms.toFixed(0)}ms@ctx${g.ctx.toFixed(1)}`).join(' ') || 'none');
console.log('shot offsets (ctx s):', offsets.map((o) => o?.toFixed(3)).join(' '));
const bounds = [...m.starts, m.duration];
const total = Math.round(m.duration * sr);
const out = new Float32Array(total * 2);
const XF = 480; // 10 ms crossfade at each splice
const src = (k, n) => Math.round((offsets[k] - base) * sr) + (n - Math.round(m.starts[k] * sr));
for (let k = 0; k < m.starts.length; k++) {
  const a = Math.round(bounds[k] * sr), b = Math.round(bounds[k + 1] * sr);
  for (let n = a; n < b; n++) {
    const s = src(k, n);
    for (let c = 0; c < 2; c++) {
      let v = abs[2 * s + c] ?? 0;
      if (k > 0 && n - a < XF) {
        const w = (n - a) / XF, p = src(k - 1, n);
        v = v * w + (abs[2 * p + c] ?? 0) * (1 - w);
      }
      out[2 * n + c] = v;
    }
  }
}
// Fade in and out with the picture.
const F = sr;
for (let i = 0; i < F; i++) for (let c = 0; c < 2; c++) { out[2 * i + c] *= i / F; out[2 * (total - 1 - i) + c] *= i / F; }
const hdr = Buffer.alloc(44), bytes = out.length * 4;
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + bytes, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16);
hdr.writeUInt16LE(3, 20); hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(sr, 24); hdr.writeUInt32LE(sr * 8, 28);
hdr.writeUInt16LE(8, 32); hdr.writeUInt16LE(32, 34); hdr.write('data', 36); hdr.writeUInt32LE(bytes, 40);
fs.writeFileSync('recordings/film-audio.wav', Buffer.concat([hdr, Buffer.from(out.buffer)]));
console.log('wrote recordings/film-audio.wav', (total / sr).toFixed(2), 's');
