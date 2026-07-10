// Maps mic level samples (0..1) to waveform bar heights in px (U3).
// The overlay keeps a rolling history of levels; the newest sample is the
// rightmost bar, so speech visibly "scrolls" through the pill.

export const BAR_COUNT = 21;
export const MIN_BAR_PX = 3;
export const MAX_BAR_PX = 26;

/** Latest `BAR_COUNT` levels, newest last, left-padded with zeros. */
export function levelsToBars(history: number[], barCount: number = BAR_COUNT): number[] {
  const recent = history.slice(-barCount);
  const padded = new Array<number>(Math.max(0, barCount - recent.length))
    .fill(0)
    .concat(recent);
  return padded.map(levelToHeight);
}

export function levelToHeight(level: number): number {
  const clamped = Math.min(1, Math.max(0, level));
  return Math.round((MIN_BAR_PX + (MAX_BAR_PX - MIN_BAR_PX) * clamped) * 10) / 10;
}

/** Push a level into a bounded history buffer (mutates and returns it). */
export function pushLevel(history: number[], level: number, cap: number = BAR_COUNT * 2): number[] {
  history.push(Math.min(1, Math.max(0, level)));
  if (history.length > cap) history.splice(0, history.length - cap);
  return history;
}
