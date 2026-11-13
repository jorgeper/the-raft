// U4: filler-list editor logic — add / remove / reset (SPEC §8.2).

import { describe, expect, it } from "vitest";
import { addFiller, removeFiller, resetFillers } from "../../src/lib/fillers";
import { DEFAULT_FILLERS } from "../../src/ipc/types";

describe("U4: filler list editing", () => {
  it("adds normalized words", () => {
    expect(addFiller(["um"], "  Basically ")).toEqual(["um", "basically"]);
  });

  it("rejects duplicates, empties, and multi-word entries", () => {
    const list = ["um", "uh"];
    expect(addFiller(list, "um")).toBe(list);
    expect(addFiller(list, "UM")).toBe(list);
    expect(addFiller(list, "   ")).toBe(list);
    expect(addFiller(list, "you know")).toBe(list);
  });

  it("removes exactly the given word", () => {
    expect(removeFiller(["um", "uh", "er"], "uh")).toEqual(["um", "er"]);
    expect(removeFiller(["um"], "nope")).toEqual(["um"]);
  });

  it("reset returns a fresh copy of the defaults", () => {
    const reset = resetFillers();
    expect(reset).toEqual(DEFAULT_FILLERS);
    reset.push("mutation");
    expect(resetFillers()).toEqual(DEFAULT_FILLERS); // no shared state
  });
});
