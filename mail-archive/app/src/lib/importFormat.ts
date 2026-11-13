// Text for the import summary and progress. Numbers use en-US grouping.
import type { ImportSummary, Progress, ScanReport } from "./api";

const nf = new Intl.NumberFormat("en-US");
export const formatCount = (n: number) => nf.format(n);

/** The confirmation line from the spec. The first count is the unchanged
 *  messages, so the parts add up to the Takeout's total (label changes are
 *  reported on their own). */
export function summaryLine(r: ScanReport): string {
  return [
    `${formatCount(r.unchanged)} already in library`,
    `${formatCount(r.new)} new`,
    `${formatCount(r.label_changes)} label changes`,
    `${formatCount(r.removed)} no longer in Gmail (kept)`,
  ].join(" · ");
}

export const REMOVED_WARN_FRACTION = 0.05;

export const OLDER_EXPORT_WARNING =
  "This export looks older than your library. Importing it adds new mail only: labels are not rolled back and nothing is marked as no longer in Gmail.";

export function removedWarning(r: ScanReport): string | null {
  if (!(r.removed_fraction > REMOVED_WARN_FRACTION)) return null;
  const pct = Math.round(r.removed_fraction * 1000) / 10;
  return `${formatCount(r.removed)} messages (${pct}% of your library) are missing from this export and would be marked as no longer in Gmail. Check that the export is complete before importing. They stay in your library either way.`;
}

export function parseErrorLine(count: number): string | null {
  return count > 0
    ? `${formatCount(count)} ${count === 1 ? "message" : "messages"} could not be read and will be skipped.`
    : null;
}

export function doneLine(s: ImportSummary): string {
  return [
    `${formatCount(s.added)} added`,
    `${formatCount(s.relabelled)} label changes`,
    `${formatCount(s.removed_marked)} marked no longer in Gmail`,
  ].join(" · ");
}

/** Seconds left, from bytes read so far. `rate_per_sec` is messages per second,
 *  so elapsed = processed / rate; null when the total is unknown or nothing has moved. */
export function etaSeconds(p: Progress): number | null {
  if (!p.total_bytes || p.total_bytes <= 0) return null;
  if (!(p.rate_per_sec > 0) || p.processed <= 0 || p.bytes <= 0 || p.bytes > p.total_bytes) return null;
  const elapsed = p.processed / p.rate_per_sec;
  return (elapsed * (p.total_bytes - p.bytes)) / p.bytes;
}

export function formatEta(secs: number): string {
  if (secs < 60) return "less than a minute left";
  const mins = Math.ceil(secs / 60);
  if (mins < 60) return `about ${mins} min left`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `about ${h} h left` : `about ${h} h ${m} min left`;
}

/** "12,345 messages · 800/s · about 4 min left" (no ETA when it cannot be known). */
export function progressLine(p: Progress | null): string {
  if (!p) return "Starting…";
  const parts = [`${formatCount(p.processed)} messages`, `${formatCount(Math.round(p.rate_per_sec))}/s`];
  const eta = etaSeconds(p);
  if (eta !== null) parts.push(formatEta(eta));
  if (p.errors > 0) parts.push(`${formatCount(p.errors)} skipped`);
  return parts.join(" · ");
}
