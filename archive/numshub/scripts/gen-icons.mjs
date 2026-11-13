// Generates the base app icon and the three tray-state icons as PNGs, with no
// image dependencies (raw RGBA -> zlib -> PNG). Run once; `npx tauri icon`
// derives the full platform icon set from icons/base-icon.png afterwards.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // filter 0 per scanline
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Anti-aliased signed-distance drawing: sample 4x4 per pixel.
function draw(width, height, sdf, color) {
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let cover = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++)
          if (sdf(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4) <= 0) cover++;
      const a = (cover / 16) * 255;
      const i = (y * width + x) * 4;
      const [r, g, b] = color(x, y);
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = Math.round(a);
    }
  }
  return rgba;
}

const sdRoundRect = (px, py, cx, cy, w, h, r) => {
  const dx = Math.abs(px - cx) - (w / 2 - r);
  const dy = Math.abs(py - cy) - (h / 2 - r);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r;
};
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;
const union = (...ds) => Math.min(...ds);
const subtract = (a, b) => Math.max(a, -b);

// Microphone glyph SDF centered at (cx, cy), height s.
function micSdf(px, py, cx, cy, s, filled = true) {
  const capW = s * 0.34;
  const capH = s * 0.52;
  const capsule = sdRoundRect(px, py, cx, cy - s * 0.14, capW, capH, capW / 2);
  // Arc (U shape): ring segment below the capsule.
  const ringOuter = sdCircle(px, py, cx, cy + s * 0.02, s * 0.31);
  const ringInner = sdCircle(px, py, cx, cy + s * 0.02, s * 0.22);
  let ring = subtract(ringOuter, ringInner);
  if (py < cy + s * 0.02) ring = 1e9; // keep bottom half only
  const stem = sdRoundRect(px, py, cx, cy + s * 0.38, s * 0.07, s * 0.16, s * 0.03);
  const base = sdRoundRect(px, py, cx, cy + s * 0.47, s * 0.3, s * 0.06, s * 0.03);
  const parts = union(capsule, ring, stem, base);
  if (filled) return parts;
  return parts;
}

// --- App icon: dark rounded square + white mic ---
{
  const S = 1024;
  const bg = (px, py) => sdRoundRect(px, py, S / 2, S / 2, S * 0.92, S * 0.92, S * 0.21);
  const mic = (px, py) => micSdf(px, py, S / 2, S / 2, S * 0.52);
  const rgba = draw(S, S, bg, (x, y) => {
    // inside mic -> near-white; else deep indigo gradient
    if (mic(x + 0.5, y + 0.5) <= 0) return [240, 243, 255];
    const t = y / S;
    return [24 + 18 * t, 26 + 14 * t, 44 + 36 * t];
  });
  // Punch nothing — mic is colored inline above.
  mkdirSync(join(root, "src-tauri/icons"), { recursive: true });
  writeFileSync(join(root, "src-tauri/icons/base-icon.png"), encodePng(S, S, rgba));
  console.log("wrote src-tauri/icons/base-icon.png");
}

// --- Tray icons: 44x44 monochrome (black + alpha, rendered as template) ---
function trayIcon(name, sdf) {
  const S = 44;
  const rgba = draw(S, S, sdf, () => [0, 0, 0]);
  mkdirSync(join(root, "src-tauri/resources"), { recursive: true });
  writeFileSync(join(root, `src-tauri/resources/${name}`), encodePng(S, S, rgba));
  console.log(`wrote src-tauri/resources/${name}`);
}

trayIcon("tray-idle.png", (px, py) => micSdf(px, py, 22, 21, 30));
trayIcon("tray-recording.png", (px, py) =>
  union(micSdf(px, py, 22, 21, 30), sdCircle(px, py, 35, 9, 6)),
);
trayIcon("tray-processing.png", (px, py) =>
  union(
    sdCircle(px, py, 11, 22, 3.4),
    sdCircle(px, py, 22, 22, 3.4),
    sdCircle(px, py, 33, 22, 3.4),
  ),
);
