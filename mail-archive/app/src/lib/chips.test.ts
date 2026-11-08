import { describe, expect, it } from "vitest";
import {
  applySuggestion,
  byteToCharIndex,
  currentToken,
  insertOperator,
  removeSpan,
} from "./chips";

describe("removeSpan", () => {
  it("removes a chip in the middle without a double space", () => {
    expect(removeSpan("a from:bob b", 2, 10)).toBe("a b");
  });
  it("removes a chip at the start", () => {
    expect(removeSpan("from:bob b", 0, 8)).toBe("b");
  });
  it("removes a chip at the end", () => {
    expect(removeSpan("a from:bob", 2, 10)).toBe("a");
  });
  it("removes the only chip", () => {
    expect(removeSpan("from:bob", 0, 8)).toBe("");
  });
  it("uses UTF-8 byte offsets (multi-byte, second chip)", () => {
    const q = "from:josé after:2020/01/01";
    // "from:josé" is 10 bytes (é = 2), then a space, so the second chip starts at byte 11.
    const end = new TextEncoder().encode(q).length;
    expect(removeSpan(q, 11, end)).toBe("from:josé");
  });
  it("removes a multi-byte first chip", () => {
    expect(removeSpan("from:josé after:2020/01/01", 0, 10)).toBe("after:2020/01/01");
  });
});

describe("byteToCharIndex", () => {
  it("maps bytes to UTF-16 indexes across 2, 3 and 4 byte characters", () => {
    const q = "é€😀x";
    expect(byteToCharIndex(q, 0)).toBe(0);
    expect(byteToCharIndex(q, 2)).toBe(1);
    expect(byteToCharIndex(q, 5)).toBe(2);
    expect(byteToCharIndex(q, 9)).toBe(4);
    expect(byteToCharIndex(q, 10)).toBe(5);
  });
  it("clamps past the end", () => {
    expect(byteToCharIndex("ab", 99)).toBe(2);
  });
});

describe("insertOperator", () => {
  it("appends with a single space and quotes values with spaces", () => {
    expect(insertOperator("a", "label:Receipts 2019")).toBe('a label:"Receipts 2019"');
  });
  it("does not leave double spaces after trailing whitespace", () => {
    expect(insertOperator("a  ", "has:attachment")).toBe("a has:attachment");
  });
  it("works on an empty query", () => {
    expect(insertOperator("", "after:2020-01-01")).toBe("after:2020-01-01");
  });
  it("keeps an already quoted value", () => {
    expect(insertOperator("", 'label:"A b"')).toBe('label:"A b"');
  });
});

describe("currentToken", () => {
  it("finds the operator and prefix at the caret", () => {
    expect(currentToken("x from:an", 9)).toMatchObject({ operator: "from", prefix: "an" });
  });
  it("reports label with an empty prefix", () => {
    expect(currentToken("label:", 6)).toMatchObject({ operator: "label", prefix: "" });
  });
  it("is case-insensitive and ignores negation", () => {
    expect(currentToken("-TO:bo", 6)).toMatchObject({ operator: "to", prefix: "bo", start: 1 });
  });
  it("handles an open quote with spaces", () => {
    expect(currentToken('label:"Rec 20', 13)).toMatchObject({ operator: "label", prefix: "Rec 20" });
  });
  it("returns null for plain words and other operators", () => {
    expect(currentToken("hello", 5).operator).toBeNull();
    expect(currentToken("after:20", 8).operator).toBeNull();
  });
  it("treats ( ) { } as delimiters", () => {
    expect(currentToken("(from:an", 8)).toMatchObject({ operator: "from", prefix: "an", start: 1, end: 8 });
    const q = "{from:an to:b}";
    expect(currentToken(q, 8)).toMatchObject({ operator: "from", prefix: "an", start: 1, end: 8 });
    expect(currentToken(q, 13)).toMatchObject({ operator: "to", prefix: "b", start: 9, end: 13 });
    expect(currentToken("(from:an)", 8)).toMatchObject({ prefix: "an" });
  });
  it("uses only the token under the caret", () => {
    expect(currentToken("from:al to:bo", 7)).toMatchObject({ operator: "from", prefix: "al" });
  });
});

describe("applySuggestion", () => {
  it("replaces the token and moves the caret after it", () => {
    const q = "x from:an y";
    const r = applySuggestion(q, currentToken(q, 9), "Ana Díaz <ana@x.org>");
    // Only the bare address is inserted, so any display name matches.
    expect(r.query).toBe("x from:ana@x.org y");
    expect(r.caret).toBe(16);
  });
  it("uses the whole string when there are no angle brackets", () => {
    const q = "to:b";
    expect(applySuggestion(q, currentToken(q, 4), "bob@x.org").query).toBe("to:bob@x.org ");
  });
  it("keeps full label names (quoted when needed)", () => {
    const q = "label:R";
    expect(applySuggestion(q, currentToken(q, 7), "Receipts 2019").query).toBe('label:"Receipts 2019" ');
  });
  it("appends a space when the token is at the end", () => {
    const q = "label:Rec";
    const r = applySuggestion(q, currentToken(q, 9), "Receipts");
    expect(r.query).toBe("label:Receipts ");
    expect(r.caret).toBe(15);
  });
});
