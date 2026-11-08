import { describe, expect, it } from "vitest";
import { copyText, formatDate, formatFull, highlightParts, resultsHeader } from "./format";

const at = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  Math.floor(new Date(y, mo - 1, d, h, mi).getTime() / 1000);

describe("formatDate", () => {
  const now = new Date(2026, 10, 8, 15, 0); // Nov 8 2026, local
  it("shows the time for today", () => {
    expect(formatDate(at(2026, 11, 8, 9, 5), now)).toBe("9:05 AM");
    expect(formatDate(at(2026, 11, 8, 0, 30), now)).toBe("12:30 AM");
    expect(formatDate(at(2026, 11, 8, 13, 45), now)).toBe("1:45 PM");
    expect(formatDate(at(2026, 11, 8, 12, 0), now)).toBe("12:00 PM");
  });
  it("shows Mon D earlier this year", () => {
    expect(formatDate(at(2026, 11, 7, 23, 59), now)).toBe("Nov 7");
    expect(formatDate(at(2026, 1, 2), now)).toBe("Jan 2");
  });
  it("shows M/D/YY for other years", () => {
    expect(formatDate(at(2025, 12, 31), now)).toBe("12/31/25");
    expect(formatDate(at(2009, 3, 4), now)).toBe("3/4/09");
  });
});

describe("formatFull / copyText", () => {
  it("formats the full local date and time", () => {
    expect(formatFull(at(2026, 11, 8, 15, 7))).toBe("Nov 8, 2026, 3:07 PM");
  });
  it("copies subject, sender and date", () => {
    const t = {
      thrid: "1", latest_date: at(2026, 11, 8, 15, 7), senders: ["Ana", "Bo"], message_count: 2,
      subject: "Hi", snippet: "", has_attachment: false, matched: [],
    };
    expect(copyText(t)).toBe("Hi — Ana, Bo — Nov 8, 2026, 3:07 PM");
  });
});

describe("copyText with missing parts", () => {
  const base = {
    thrid: "1", latest_date: at(2026, 11, 8, 15, 7), senders: [] as string[], message_count: 1,
    subject: "", snippet: "", has_attachment: false, matched: [],
  };
  it("never leaves an empty segment", () => {
    expect(copyText({ ...base })).toBe("Nov 8, 2026, 3:07 PM");
    expect(copyText({ ...base, subject: "Hi" })).toBe("Hi — Nov 8, 2026, 3:07 PM");
    expect(copyText({ ...base, senders: ["Ana"] })).toBe("Ana — Nov 8, 2026, 3:07 PM");
  });
});

describe("highlightParts", () => {
  it("splits on terms case-insensitively", () => {
    expect(highlightParts("Hello World hello", ["hello"])).toEqual([
      { text: "Hello", mark: true },
      { text: " World ", mark: false },
      { text: "hello", mark: true },
    ]);
  });
  it("treats terms literally, not as a regex", () => {
    expect(highlightParts("a.c abc", ["a.c"])).toEqual([
      { text: "a.c", mark: true },
      { text: " abc", mark: false },
    ]);
    expect(highlightParts("x", ["(", "["])).toEqual([{ text: "x", mark: false }]);
  });
  it("returns the text untouched without terms and ignores empty terms", () => {
    expect(highlightParts("abc", [])).toEqual([{ text: "abc", mark: false }]);
    expect(highlightParts("abc", [""])).toEqual([{ text: "abc", mark: false }]);
    expect(highlightParts("", ["a"])).toEqual([]);
  });
  it("prefers the longest term", () => {
    expect(highlightParts("foobar", ["foo", "foobar"])).toEqual([{ text: "foobar", mark: true }]);
  });
});

describe("resultsHeader", () => {
  it("shows the count with thousands separators and whole milliseconds", () => {
    expect(resultsHeader({ total_messages: 1234567, elapsed_ms: 2.5341, capped: false })).toBe(
      "1,234,567 messages · 3 ms",
    );
    expect(resultsHeader({ total_messages: 12, elapsed_ms: 0.4, capped: false })).toBe("12 messages · 0 ms");
  });
  it("says when only the newest 5,000 matches are listed", () => {
    expect(resultsHeader({ total_messages: 12345, elapsed_ms: 9.9, capped: true })).toBe(
      "Showing the newest 5,000 of 12,345 messages — narrow your search to see older mail",
    );
  });
});
