// Pure helpers that keep the query text and the filter chips in sync.
// Spans coming from Rust are UTF-8 BYTE offsets; everything else here uses
// UTF-16 string indexes (what the DOM and String.slice use).

export type Operator = "label" | "from" | "to";

export interface Token {
  operator: Operator | null;
  prefix: string;
  /** Char index where the `operator:value` text starts (after any leading `-`). */
  start: number;
  /** Char index just past the token. */
  end: number;
}

/** Convert a UTF-8 byte offset into a UTF-16 string index (clamped to the string). */
export function byteToCharIndex(query: string, byteIdx: number): number {
  let bytes = 0;
  let i = 0;
  while (i < query.length && bytes < byteIdx) {
    const cp = query.codePointAt(i)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    i += cp > 0xffff ? 2 : 1;
  }
  return i;
}

/** Remove a byte span plus one adjacent space, never leaving a double space. */
export function removeSpan(query: string, startByte: number, endByte: number): string {
  const s = byteToCharIndex(query, startByte);
  const e = byteToCharIndex(query, endByte);
  let left = query.slice(0, s);
  let right = query.slice(e);
  if (left.endsWith(" ")) {
    if (right === "" || right.startsWith(" ")) left = left.slice(0, -1);
  } else if (left === "" && right.startsWith(" ")) {
    right = right.slice(1);
  }
  return left + right;
}

const NEEDS_QUOTES = /[\s()<>{}]/;

function quoteIfNeeded(value: string): string {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) return value;
  const clean = value.replaceAll('"', "");
  return NEEDS_QUOTES.test(clean) ? `"${clean}"` : clean;
}

function formatOperator(op: string): string {
  const colon = op.indexOf(":");
  if (colon < 0) return op;
  return op.slice(0, colon + 1) + quoteIfNeeded(op.slice(colon + 1));
}

/** Append `op` (e.g. `label:Receipts 2019`) with a single space, quoting values with spaces. */
export function insertOperator(query: string, op: string): string {
  const base = query.trimEnd();
  const formatted = formatOperator(op);
  return base === "" ? formatted : `${base} ${formatted}`;
}

/** Whitespace-separated tokens as [start, end) char ranges; spaces inside quotes do not split. */
function tokenRanges(query: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let start = -1;
  let inQuote = false;
  for (let i = 0; i < query.length; i++) {
    const c = query[i];
    if (c === '"') inQuote = !inQuote;
    const isSpace = !inQuote && /\s/.test(c);
    if (isSpace) {
      if (start >= 0) out.push([start, i]);
      start = -1;
    } else if (start < 0) {
      start = i;
    }
  }
  if (start >= 0) out.push([start, query.length]);
  return out;
}

const OPERATOR_TOKEN = /^(label|from|to):(.*)$/is;

/** The `label:` / `from:` / `to:` token under the caret, if any. */
export function currentToken(query: string, caret: number): Token {
  for (const [s, e] of tokenRanges(query)) {
    if (caret < s || caret > e) continue;
    const neg = query[s] === "-" ? 1 : 0;
    const m = OPERATOR_TOKEN.exec(query.slice(s + neg, e));
    if (!m) break;
    return {
      operator: m[1].toLowerCase() as Operator,
      prefix: m[2].replace(/^"/, "").replace(/"$/, ""),
      start: s + neg,
      end: e,
    };
  }
  return { operator: null, prefix: "", start: caret, end: caret };
}

/** Replace the token with `operator:value`; returns the new query and caret position. */
export function applySuggestion(
  query: string,
  token: Token,
  value: string,
): { query: string; caret: number } {
  const text = `${token.operator}:${quoteIfNeeded(value)}`;
  const left = query.slice(0, token.start);
  let right = query.slice(token.end);
  let caret = token.start + text.length;
  if (right === "") {
    right = " ";
    caret += 1;
  }
  return { query: left + text + right, caret };
}
