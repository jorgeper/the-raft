// U5: onboarding gate resolution (SPEC2 §3, §4).

import { describe, expect, it } from "vitest";
import { firstUnmetStep, stepsFor, type GateSnapshot } from "../../src/lib/onboarding";

const fresh: GateSnapshot = {
  microphone: false,
  accessibility: false,
  captureReady: false,
  trayVisible: false,
  modelReady: false,
  platform: "macos",
};

describe("U5: firstUnmetStep", () => {
  it("a truly fresh user starts at welcome", () => {
    expect(firstUnmetStep(fresh, [])).toBe("welcome");
  });

  it("any prior progress bypasses welcome", () => {
    expect(firstUnmetStep({ ...fresh, microphone: true }, [])).toBe("accessibility");
    expect(firstUnmetStep(fresh, ["menubar"])).toBe("microphone");
  });

  it("walks the macOS gates in order", () => {
    expect(firstUnmetStep({ ...fresh, modelReady: true }, [])).toBe("microphone");
    expect(
      firstUnmetStep({ ...fresh, microphone: true, accessibility: true, captureReady: true }, []),
    ).toBe("menubar");
    expect(
      firstUnmetStep(
        { ...fresh, microphone: true, accessibility: true, captureReady: true, trayVisible: true },
        [],
      ),
    ).toBe("model");
    expect(
      firstUnmetStep(
        {
          ...fresh,
          microphone: true,
          accessibility: true,
          captureReady: true,
          trayVisible: true,
          modelReady: true,
        },
        [],
      ),
    ).toBe("try");
  });

  it("accessibility is a two-fact gate: permission alone is not met", () => {
    expect(firstUnmetStep({ ...fresh, microphone: true, accessibility: true }, [])).toBe(
      "accessibility",
    );
    expect(
      firstUnmetStep({ ...fresh, microphone: true, accessibility: true, captureReady: true }, []),
    ).toBe("menubar");
  });

  it("explicit deferrals count as met, but just for deferrable steps", () => {
    expect(firstUnmetStep({ ...fresh, microphone: true }, ["accessibility"])).toBe("menubar");
    expect(firstUnmetStep({ ...fresh, microphone: true }, ["accessibility", "menubar"])).toBe(
      "model",
    );
    // "microphone" is not deferrable — a deferral entry for it changes nothing.
    expect(firstUnmetStep(fresh, ["microphone"])).toBe("microphone");
  });

  it("non-mac platforms omit mac-specific steps entirely", () => {
    expect(stepsFor("windows")).toEqual(["welcome", "microphone", "model", "try"]);
    expect(firstUnmetStep({ ...fresh, platform: "windows", microphone: true }, [])).toBe("model");
    expect(
      firstUnmetStep({ ...fresh, platform: "windows", microphone: true, modelReady: true }, []),
    ).toBe("try");
  });

  it("try is terminal and always reachable", () => {
    const all: GateSnapshot = {
      microphone: true,
      accessibility: true,
      captureReady: true,
      trayVisible: true,
      modelReady: true,
      platform: "macos",
    };
    expect(firstUnmetStep(all, [])).toBe("try");
  });
});
