export type PitchType = 'fastball' | 'curve' | 'changeup';
export type Lane = -1 | 0 | 1;

export type Outcome =
  | 'homerun'
  | 'triple'
  | 'double'
  | 'single'
  | 'flyout'
  | 'groundout'
  | 'foul'
  | 'strike';

export const POWER_SET: Outcome[] = ['homerun', 'triple', 'double', 'single'];
export const CONTACT_SET: Outcome[] = ['single', 'double', 'flyout', 'groundout'];

/** Cumulative-weight pick. */
function pick(rng: () => number, table: [Outcome, number][]): Outcome {
  let r = rng();
  for (const [outcome, w] of table) {
    if (r < w) return outcome;
    r -= w;
  }
  return table[table.length - 1][0];
}

/**
 * SPEC §2.3 — outcome is a pure function of swing-timing offset (ms between
 * swing and the ball crossing the plate; null = no swing) and pitch type,
 * resolved with the seeded PRNG.
 */
export function resolveSwing(
  offsetMs: number | null,
  _pitch: PitchType,
  rng: () => number,
): Outcome {
  if (offsetMs === null) return 'strike';
  const off = Math.abs(offsetMs);
  if (off <= 40) {
    return pick(rng, [
      ['homerun', 0.3],
      ['triple', 0.1],
      ['double', 0.3],
      ['single', 0.3],
    ]);
  }
  if (off <= 90) {
    return pick(rng, [
      ['single', 0.45],
      ['double', 0.15],
      ['flyout', 0.25],
      ['groundout', 0.15],
    ]);
  }
  if (off <= 140) return 'foul';
  return 'strike';
}

/** Ball flight time per pitch type (ms), used by render + CPU. SPEC §2.5. */
export const FLIGHT_MS: Record<PitchType, number> = {
  fastball: 520,
  curve: 640,
  changeup: 700,
};
