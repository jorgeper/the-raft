import { describe, expect, it } from "vitest";
import type { Progress, ScanReport } from "./api";
import { etaSeconds, formatEta, progressLine, removedWarning, summaryLine } from "./importFormat";

const report = (o: Partial<ScanReport> = {}): ScanReport => ({
  kind: "Full", source_label: "x", total: 0, new: 0, label_changes: 0, unchanged: 0, removed: 0,
  removed_fraction: 0, matched_by_content: 0, matched_by_header: 0, parse_errors: 0,
  duplicates_in_source: 0, looks_older: false, ...o,
});
const prog = (o: Partial<Progress> = {}): Progress => ({
  phase: "scan", processed: 1000, bytes: 100, total_bytes: 400, rate_per_sec: 100, errors: 0, ...o,
});

describe("summaryLine", () => {
  it("matches the spec's form exactly", () => {
    expect(summaryLine(report({ unchanged: 412330, new: 3812, label_changes: 1140, removed: 96 }))).toBe(
      "412,330 already in library · 3,812 new · 1,140 label changes · 96 no longer in Gmail (kept)",
    );
  });
});

describe("removedWarning", () => {
  it("warns above 5% only", () => {
    expect(removedWarning(report({ removed: 5, removed_fraction: 0.05 }))).toBeNull();
    const w = removedWarning(report({ removed: 6000, removed_fraction: 0.0612 }))!;
    expect(w).toContain("6,000");
    expect(w).toContain("6.1%");
  });
});

describe("ETA", () => {
  it("uses bytes read against the total at the observed pace", () => {
    // 1000 messages at 100/s = 10 s elapsed for 100 of 400 bytes: 30 s left.
    expect(etaSeconds(prog())).toBeCloseTo(30);
  });
  it("is unknown without a total or progress", () => {
    expect(etaSeconds(prog({ total_bytes: null }))).toBeNull();
    expect(etaSeconds(prog({ bytes: 0 }))).toBeNull();
    expect(etaSeconds(prog({ rate_per_sec: 0 }))).toBeNull();
    expect(etaSeconds(prog({ bytes: 500 }))).toBeNull();
  });
  it("formats coarse durations", () => {
    expect(formatEta(30)).toBe("less than a minute left");
    expect(formatEta(61)).toBe("about 2 min left");
    expect(formatEta(3600)).toBe("about 1 h left");
    expect(formatEta(5400)).toBe("about 1 h 30 min left");
  });
  it("progressLine omits the ETA when unknown", () => {
    expect(progressLine(prog({ processed: 12345 }))).toContain("12,345 messages");
    expect(progressLine(prog({ total_bytes: null }))).not.toContain("left");
    expect(progressLine(null)).toBe("Starting…");
  });
});
