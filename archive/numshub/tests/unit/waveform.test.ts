// U3: waveform mapping — level samples to bar heights (SPEC §8.2).

import { describe, expect, it } from "vitest";
import {
  BAR_COUNT,
  levelsToBars,
  levelToHeight,
  MAX_BAR_PX,
  MIN_BAR_PX,
  pushLevel,
} from "../../src/lib/waveform";

describe("U3: waveform mapping", () => {
  it("always produces BAR_COUNT bars, zero-padded on the left", () => {
    const bars = levelsToBars([0.5, 1.0]);
    expect(bars).toHaveLength(BAR_COUNT);
    expect(bars[0]).toBe(MIN_BAR_PX); // silence pad
    expect(bars[BAR_COUNT - 1]).toBe(MAX_BAR_PX); // newest = rightmost
    expect(bars[BAR_COUNT - 2]).toBeCloseTo((MIN_BAR_PX + MAX_BAR_PX) / 2, 0);
  });

  it("keeps just the newest levels when history exceeds the bar count", () => {
    const history = Array.from({ length: 100 }, (_, i) => (i >= 99 ? 1 : 0));
    const bars = levelsToBars(history);
    expect(bars[BAR_COUNT - 1]).toBe(MAX_BAR_PX);
    expect(bars[0]).toBe(MIN_BAR_PX);
  });

  it("clamps levels outside 0..1", () => {
    expect(levelToHeight(-3)).toBe(MIN_BAR_PX);
    expect(levelToHeight(42)).toBe(MAX_BAR_PX);
  });

  it("pushLevel bounds the history buffer", () => {
    const history: number[] = [];
    for (let i = 0; i < 500; i++) pushLevel(history, 0.5);
    expect(history.length).toBeLessThanOrEqual(BAR_COUNT * 2);
    expect(history.every((l) => l === 0.5)).toBe(true);
  });
});
