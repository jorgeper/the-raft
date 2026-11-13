// U2: hotkey label formatting — bare modifiers and combos (SPEC §8.2).

import { describe, expect, it } from "vitest";
import { formatHotkey } from "../../src/lib/hotkey";

describe("U2: hotkey label formatting", () => {
  it("formats bare sided modifiers", () => {
    expect(formatHotkey("command_right")).toBe("Right ⌘");
    expect(formatHotkey("command_left")).toBe("Left ⌘");
    expect(formatHotkey("option_right")).toBe("Right ⌥");
    expect(formatHotkey("ctrl_right")).toBe("Right ⌃");
    expect(formatHotkey("shift_left")).toBe("Left ⇧");
  });

  it("formats modifier+key combos", () => {
    expect(formatHotkey("ctrl+space")).toBe("⌃ Space");
    expect(formatHotkey("command+shift+a")).toBe("⌘ ⇧ A");
    expect(formatHotkey("option_left+space")).toBe("Left ⌥ Space");
  });

  it("formats plain keys and edge cases", () => {
    expect(formatHotkey("escape")).toBe("Esc");
    expect(formatHotkey("f19")).toBe("F19");
    expect(formatHotkey("")).toBe("");
  });
});
