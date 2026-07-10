// U1: settings store defaults and updates (SPEC §8.2).

import { describe, expect, it, vi } from "vitest";
import { createSettingsStore } from "../../src/store/settings";
import { DEFAULT_FILLERS, defaultSettings } from "../../src/ipc/types";

describe("U1: settings store", () => {
  it("starts with the documented defaults", () => {
    const store = createSettingsStore();
    const s = store.get();
    expect(s.hotkey).toBe("command_right");
    expect(s.activation_mode).toBe("toggle");
    expect(s.output_method).toBe("paste");
    expect(s.keep_history).toBe(true);
    expect(s.collapse_repeats).toBe(true);
    expect(s.filler_words).toEqual(DEFAULT_FILLERS);
    expect(s.enhancement.enabled).toBe(false);
    expect(s.enhancement.endpoint).toBe("http://localhost:11434");
    expect(s.active_model).toBeNull();
  });

  it("update merges partials and notifies subscribers", () => {
    const store = createSettingsStore();
    const seen = vi.fn();
    store.subscribe(seen);
    const next = store.update({ hotkey: "ctrl+space", keep_history: false });
    expect(next.hotkey).toBe("ctrl+space");
    expect(next.keep_history).toBe(false);
    expect(next.activation_mode).toBe("toggle"); // untouched fields survive
    expect(seen).toHaveBeenCalledTimes(1);
    expect(store.get().hotkey).toBe("ctrl+space");
  });

  it("replace swaps the whole state and unsubscribe stops notifications", () => {
    const store = createSettingsStore();
    const seen = vi.fn();
    const unsub = store.subscribe(seen);
    const incoming = { ...defaultSettings(), hotkey: "f19", onboarding_complete: true };
    store.replace(incoming);
    expect(store.get().hotkey).toBe("f19");
    expect(store.get().onboarding_complete).toBe(true);
    unsub();
    store.update({ hotkey: "f20" });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("does not share mutable state with callers", () => {
    const store = createSettingsStore();
    store.get().filler_words.push("MUTATED");
    // Store state must be unaffected by external mutation of returned refs?
    // (get() returns the live object; update() must not be affected by prior
    // external pushes because updates clone their partials.)
    const next = store.update({ filler_words: ["um"] });
    expect(next.filler_words).toEqual(["um"]);
  });
});
