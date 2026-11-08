import type { SearchResults, ThreadHit } from "./api";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function time(d: Date): string {
  const h = d.getHours();
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? "AM" : "PM"}`;
}

/** List-row date, in local time: today -> time, this year -> `Mon D`, else `M/D/YY`. */
export function formatDate(unixSecs: number, now: Date = new Date()): string {
  const d = new Date(unixSecs * 1000);
  if (d.getFullYear() === now.getFullYear()) {
    if (d.getMonth() === now.getMonth() && d.getDate() === now.getDate()) return time(d);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear() % 100).padStart(2, "0")}`;
}

/** Full local date and time, for message headers and copy. */
export function formatFull(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}, ${time(d)}`;
}

export function copyText(t: ThreadHit): string {
  return [t.subject, t.senders.join(", "), formatFull(t.latest_date)].filter((p) => p.length > 0).join(" — ");
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface Part {
  text: string;
  mark: boolean;
}

/** Split `text` around the terms. Components render parts as text nodes
 * (never as HTML), so a subject containing `<b>` stays text. */
export function highlightParts(text: string, terms: string[]): Part[] {
  if (!text) return [];
  const ts = [...new Set(terms.filter((t) => t.length > 0))].sort((a, b) => b.length - a.length);
  if (ts.length === 0) return [{ text, mark: false }];
  const re = new RegExp(ts.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "giu");
  const parts: Part[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m[0].length === 0) continue;
    if (m.index > last) parts.push({ text: text.slice(last, m.index), mark: false });
    parts.push({ text: m[0], mark: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), mark: false });
  return parts;
}

/** Matches grouped into threads per search; mirrors MAX_COLLECTED in crates/core/src/query/exec.rs. */
export const MAX_COLLECTED = 5000;

const count = (n: number) => n.toLocaleString("en-US");

/** The line above the results list. */
export function resultsHeader(r: Pick<SearchResults, "total_messages" | "elapsed_ms" | "capped">): string {
  if (r.capped) {
    return `Showing the newest ${count(MAX_COLLECTED)} of ${count(r.total_messages)} messages — narrow your search to see older mail`;
  }
  return `${count(r.total_messages)} messages · ${Math.round(r.elapsed_ms)} ms`;
}
