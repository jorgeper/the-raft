// Pure AABB helpers in "track space": s = distance along trail (forward),
// l = lateral offset from trail center, y = height above ground.
// A box: { s, l, y, hs, hl, hy } (center + half-extents).

export function makeBox(s, l, y, hs, hl, hy) {
  return { s, l, y, hs, hl, hy };
}

export function overlaps(a, b) {
  return (
    Math.abs(a.s - b.s) < a.hs + b.hs &&
    Math.abs(a.l - b.l) < a.hl + b.hl &&
    Math.abs(a.y - b.y) < a.hy + b.hy
  );
}

export function expanded(box, margin) {
  return {
    s: box.s, l: box.l, y: box.y,
    hs: box.hs + margin, hl: box.hl + margin, hy: box.hy + margin,
  };
}

// A player passes over an obstacle when their feet clear its top.
export function passesOver(playerFootY, box) {
  return playerFootY > box.y + box.hy - 0.05;
}

// Player capsule approximated as a box per spec §4.4 (0.6 × 1.7 × 0.6 m).
export function playerBox(s, l, footY) {
  return makeBox(s, l, footY + 0.85, 0.3, 0.3, 0.85);
}
