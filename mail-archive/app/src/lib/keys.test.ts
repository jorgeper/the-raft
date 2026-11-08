import { describe, expect, it } from "vitest";
import { handleKey } from "./keys";

type Target = "search" | "list" | "pane";
const k = (key: string, target: Target, o: { metaKey?: boolean } = {}) => ({
  key,
  metaKey: o.metaKey ?? false,
  target,
});
const st = (o: Partial<{ selected: number; count: number; query: string }> = {}) => ({
  selected: 2,
  count: 5,
  query: "",
  ...o,
});

describe("handleKey", () => {
  it("focuses search on cmd-F anywhere and on / outside the search box", () => {
    for (const t of ["search", "list", "pane"] as const) {
      expect(handleKey(k("f", t, { metaKey: true }), st())).toEqual({ type: "focusSearch" });
    }
    expect(handleKey(k("/", "list"), st())).toEqual({ type: "focusSearch" });
    expect(handleKey(k("/", "pane"), st())).toEqual({ type: "focusSearch" });
    expect(handleKey(k("/", "search"), st())).toEqual({ type: "none" });
  });

  it("moves the selection with arrows and clamps at both ends", () => {
    expect(handleKey(k("ArrowDown", "list"), st())).toEqual({ type: "select", index: 3 });
    expect(handleKey(k("ArrowUp", "list"), st())).toEqual({ type: "select", index: 1 });
    expect(handleKey(k("ArrowDown", "list"), st({ selected: 4 }))).toEqual({ type: "select", index: 4 });
    expect(handleKey(k("ArrowUp", "list"), st({ selected: 0 }))).toEqual({ type: "select", index: 0 });
  });

  it("does nothing with arrows on an empty list", () => {
    expect(handleKey(k("ArrowDown", "list"), st({ count: 0, selected: 0 }))).toEqual({ type: "none" });
  });

  it("moves focus to the pane on Enter or ArrowRight in the list", () => {
    expect(handleKey(k("Enter", "list"), st())).toEqual({ type: "focusPane" });
    expect(handleKey(k("ArrowRight", "list"), st())).toEqual({ type: "focusPane" });
    expect(handleKey(k("Enter", "list"), st({ count: 0 }))).toEqual({ type: "none" });
  });

  it("Escape clears the search text, then leaves for the list", () => {
    expect(handleKey(k("Escape", "search"), st({ query: "from:ana" }))).toEqual({ type: "clear" });
    expect(handleKey(k("Escape", "search"), st({ query: "" }))).toEqual({ type: "focusList" });
  });

  it("Escape and ArrowLeft in the pane return to the list", () => {
    expect(handleKey(k("Escape", "pane"), st())).toEqual({ type: "focusList" });
    expect(handleKey(k("ArrowLeft", "pane"), st())).toEqual({ type: "focusList" });
  });

  it("cmd-C copies from the list only (the search box and pane keep native copy)", () => {
    expect(handleKey(k("c", "list", { metaKey: true }), st())).toEqual({ type: "copy" });
    expect(handleKey(k("c", "search", { metaKey: true }), st())).toEqual({ type: "none" });
    expect(handleKey(k("c", "pane", { metaKey: true }), st())).toEqual({ type: "none" });
    expect(handleKey(k("c", "list", { metaKey: true }), st({ count: 0 }))).toEqual({ type: "none" });
  });

  it("ArrowDown and Enter in the search box go to the results, keeping the selection", () => {
    expect(handleKey(k("ArrowDown", "search"), st())).toEqual({ type: "enterList", index: 2 });
    expect(handleKey(k("Enter", "search"), st())).toEqual({ type: "enterList", index: 2 });
    expect(handleKey(k("ArrowDown", "search"), st({ selected: 0 }))).toEqual({ type: "enterList", index: 0 });
    // A selection past the end (results shrank) lands on the last row.
    expect(handleKey(k("Enter", "search"), st({ selected: 9 }))).toEqual({ type: "enterList", index: 4 });
  });

  it("leaves the search box alone with no results, and for other keys", () => {
    expect(handleKey(k("ArrowDown", "search"), st({ count: 0, selected: 0 }))).toEqual({ type: "none" });
    expect(handleKey(k("Enter", "search"), st({ count: 0, selected: 0 }))).toEqual({ type: "none" });
    expect(handleKey(k("ArrowUp", "search"), st())).toEqual({ type: "none" });
    expect(handleKey(k("ArrowRight", "search"), st())).toEqual({ type: "none" });
  });
});
