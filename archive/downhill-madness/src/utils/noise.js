// Deterministic 2D value noise (no Math.random) for terrain shaping.
function hashXY(x, y) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t) => t * t * (3 - 2 * t);

export function noise2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hashXY(xi, yi), b = hashXY(xi + 1, yi);
  const c = hashXY(xi, yi + 1), d = hashXY(xi + 1, yi + 1);
  const u = fade(xf), v = fade(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fractal brownian motion, 3 octaves. Returns ~0..1.
export function fbm2(x, y) {
  return (
    noise2(x, y) * 0.55 +
    noise2(x * 2.3 + 17, y * 2.3 + 31) * 0.3 +
    noise2(x * 5.1 + 47, y * 5.1 + 89) * 0.15
  );
}
