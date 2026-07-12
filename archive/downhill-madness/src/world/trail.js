// Pure trail-shape math. s = meters traveled along the trail.
// World mapping: x = centerX(s) + lateral, z = -s, y = groundY(s).

export const TRAIL_HALF_WIDTH = 4; // playable ±4 m (spec §4.2)
export const CHUNK_LENGTH = 50;
export const CHUNKS_AHEAD = 8;
export const CHUNKS_BEHIND = 1;

// Gentle lateral wander, curvature-capped so the player is never blindsided.
export function centerX(s) {
  return 7 * Math.sin(s * 0.011) + 3.5 * Math.sin(s * 0.023 + 1.7);
}

// Descending height. Base 8% grade steepening to ~14% by phase 3 (spec §5),
// plus a mild rolling undulation for airtime fun.
export function groundY(s) {
  const steep = s < 700 ? (s * s) / 1400 : 350 + (s - 700);
  return -(0.08 * s + 0.06 * steep) - 1.2 * Math.sin(s * 0.02);
}

// Downhill grade at s (positive number, e.g. 0.1 = 10%).
export function gradeAt(s) {
  const d = 0.5;
  return (groundY(s) - groundY(s + d)) / d;
}
