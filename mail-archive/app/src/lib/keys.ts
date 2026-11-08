// Keyboard model as a pure function: the App reads the event, asks what to do, does it.
export type KeyTarget = "search" | "list" | "pane";
export type Action =
  | { type: "focusSearch" }
  | { type: "select"; index: number }
  | { type: "focusPane" }
  | { type: "clear" }
  | { type: "focusList" }
  /** From the search box: select `index` and focus the results list. */
  | { type: "enterList"; index: number }
  | { type: "copy" }
  | { type: "none" };

const NONE: Action = { type: "none" };

export function handleKey(
  e: { key: string; metaKey: boolean; target: KeyTarget },
  state: { selected: number; count: number; query: string },
): Action {
  const { key, metaKey, target } = e;
  if (metaKey) {
    const k = key.toLowerCase();
    if (k === "f") return { type: "focusSearch" };
    if (k === "c" && target === "list" && state.count > 0) return { type: "copy" };
    return NONE;
  }
  if (key === "/" && target !== "search") return { type: "focusSearch" };

  switch (target) {
    case "search":
      // Only reached with no suggestion list open: SearchBox handles (and
      // preventDefaults) these keys while one is.
      if (key === "Escape") return state.query ? { type: "clear" } : { type: "focusList" };
      if ((key === "ArrowDown" || key === "Enter") && state.count > 0) {
        return { type: "enterList", index: Math.min(Math.max(state.selected, 0), state.count - 1) };
      }
      return NONE;
    case "list": {
      if (state.count === 0) return NONE;
      const last = state.count - 1;
      if (key === "ArrowDown") return { type: "select", index: Math.min(state.selected + 1, last) };
      if (key === "ArrowUp") return { type: "select", index: Math.max(state.selected - 1, 0) };
      if (key === "Enter" || key === "ArrowRight") return { type: "focusPane" };
      return NONE;
    }
    case "pane":
      if (key === "Escape" || key === "ArrowLeft") return { type: "focusList" };
      return NONE;
  }
}
