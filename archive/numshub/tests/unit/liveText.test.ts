// U6: local-agreement stabilizer (SPEC3 FR-L4).

import { describe, expect, it } from "vitest";
import { EMPTY_LIVE, stabilize, type LiveText } from "../../src/lib/liveText";

function run(passes: string[]): LiveText {
  return passes.reduce(stabilize, EMPTY_LIVE);
}

describe("U6: live-text stabilizer", () => {
  it("first pass is all tentative", () => {
    const t = stabilize(EMPTY_LIVE, "hello world");
    expect(t.stable).toBe("");
    expect(t.tentative).toBe("hello world");
  });

  it("agreement promotes words to stable as text grows", () => {
    const t = run(["hello", "hello world", "hello world again"]);
    expect(t.stable).toBe("hello world");
    expect(t.tentative).toBe("again");
  });

  it("disagreeing tail is replaced, agreed prefix stays", () => {
    const t = run(["hello ward", "hello world"]);
    expect(t.stable).toBe("hello");
    expect(t.tentative).toBe("world");
  });

  it("stable never shrinks even when a later pass returns less text", () => {
    const grown = run(["hello world", "hello world how are", "hello world how are you"]);
    expect(grown.stable).toBe("hello world how are");
    const shrunk = stabilize(grown, "hello");
    expect(shrunk.stable).toBe("hello world how are");
  });

  it("stable never rewrites — first-seen rendering is kept", () => {
    const t1 = run(["Hello world", "Hello world again"]);
    expect(t1.stable).toBe("Hello world");
    // A later pass recapitalizes: agreement is case-insensitive, but the
    // stable rendering must not change.
    const t2 = stabilize(t1, "HELLO WORLD again more");
    expect(t2.stable.startsWith("Hello world")).toBe(true);
  });

  it("punctuation-tolerant agreement on the trailing word", () => {
    const t = run(["hello.", "hello there"]);
    expect(t.stable).toBe("hello.");
    expect(t.tentative).toBe("there");
  });

  it("empty and noise passes never regress the text", () => {
    const before = run(["hello world", "hello world friend"]);
    expect(stabilize(before, "")).toEqual(before);
    expect(stabilize(before, " . ")).toEqual(before);
    expect(stabilize(before, "...")).toEqual(before);
  });

  it("reset is just starting from EMPTY_LIVE again", () => {
    const t = stabilize(EMPTY_LIVE, "fresh start");
    expect(t.stable).toBe("");
    expect(t.tentative).toBe("fresh start");
  });
});
