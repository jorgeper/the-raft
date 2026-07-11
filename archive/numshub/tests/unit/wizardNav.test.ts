// U7: wizard navigation rules (SPEC5 §5).

import { describe, expect, it } from "vitest";
import {
  backTarget,
  canNavigateTo,
  initialStep,
  isPinned,
  isReview,
  jumpTarget,
  nextStep,
} from "../../src/lib/wizardNav";

describe("U7: wizard navigation", () => {
  it("back targets follow the platform step order", () => {
    expect(backTarget("welcome", "macos")).toBeNull();
    expect(backTarget("microphone", "macos")).toBe("welcome");
    expect(backTarget("menubar", "macos")).toBe("accessibility");
    expect(backTarget("try", "macos")).toBe("model");
    // Windows omits mac-specific steps entirely.
    expect(backTarget("model", "windows")).toBe("microphone");
  });

  it("next steps follow the platform step order", () => {
    expect(nextStep("welcome", "macos")).toBe("microphone");
    expect(nextStep("accessibility", "macos")).toBe("menubar");
    expect(nextStep("try", "macos")).toBeNull();
    expect(nextStep("microphone", "windows")).toBe("model");
  });

  it("navigation is bounded by the frontier", () => {
    expect(canNavigateTo("welcome", "menubar", "macos")).toBe(true);
    expect(canNavigateTo("accessibility", "menubar", "macos")).toBe(true);
    expect(canNavigateTo("menubar", "menubar", "macos")).toBe(true);
    expect(canNavigateTo("model", "menubar", "macos")).toBe(false);
    expect(canNavigateTo("try", "menubar", "macos")).toBe(false);
  });

  it("jump target is the frontier, offered strictly when it is beyond the next step", () => {
    // On microphone with frontier at menubar: next is accessibility < menubar.
    expect(jumpTarget("microphone", "menubar", "macos")).toBe("menubar");
    // On accessibility with frontier at menubar: next IS the frontier.
    expect(jumpTarget("accessibility", "menubar", "macos")).toBeNull();
    // Last step: nothing to jump to.
    expect(jumpTarget("try", "try", "macos")).toBeNull();
  });

  it("review mode is strictly before the frontier", () => {
    expect(isReview("microphone", "menubar", "macos")).toBe(true);
    expect(isReview("menubar", "menubar", "macos")).toBe(false);
    expect(isReview("try", "menubar", "macos")).toBe(false);
  });

  it("pinned territory matches review territory (no-yank rule)", () => {
    expect(isPinned("welcome", "model", "macos")).toBe(true);
    expect(isPinned("model", "model", "macos")).toBe(false);
  });

  it("re-run intent opens at welcome regardless of the frontier", () => {
    expect(initialStep("welcome", "try")).toBe("welcome");
    expect(initialStep("welcome", "accessibility")).toBe("welcome");
    expect(initialStep("frontier", "accessibility")).toBe("accessibility");
    expect(initialStep("frontier", "try")).toBe("try");
  });
});
