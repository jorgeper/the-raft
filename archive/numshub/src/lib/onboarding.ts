// Onboarding gate resolution (SPEC2 §3, tested by U5). Pure: given a live
// snapshot of verified system facts + the user's explicit skips, decide the
// first unmet step. The wizard NEVER stores a step index — it always resumes
// from what is actually true.

export type StepId =
  | "welcome"
  | "microphone"
  | "accessibility"
  | "menubar"
  | "model"
  | "try";

export interface GateSnapshot {
  microphone: boolean;
  accessibility: boolean;
  /** The hotkey listener is actually armed (capture-ready). */
  captureReady: boolean;
  /** The menu-bar item really renders (CGWindowList probe). */
  trayVisible: boolean;
  /** A model is downloaded AND active. */
  modelReady: boolean;
  platform: string; // "macos" | "windows" | ...
}

/** Steps that may be explicitly skipped (SPEC2 §2). */
export const SKIPPABLE: readonly StepId[] = ["accessibility", "menubar"];

/** Ordered steps for a platform; permission steps that don't apply are omitted. */
export function stepsFor(platform: string): StepId[] {
  return platform === "macos"
    ? ["welcome", "microphone", "accessibility", "menubar", "model", "try"]
    : ["welcome", "microphone", "model", "try"];
}

/**
 * Is a given gate satisfied? "welcome" and "try" are informational — welcome
 * counts as met only when some later fact proves the user has been here
 * before (any grant/skip), so a truly fresh user still sees it.
 */
function gateMet(step: StepId, snap: GateSnapshot, skips: readonly string[]): boolean {
  const skipped = (s: StepId) => SKIPPABLE.includes(s) && skips.includes(s);
  switch (step) {
    case "welcome":
      return snap.microphone || snap.accessibility || snap.modelReady || skips.length > 0;
    case "microphone":
      return snap.microphone;
    case "accessibility":
      // Two facts: the permission AND the armed listener (SPEC2 FR-O2b).
      return (snap.accessibility && snap.captureReady) || skipped("accessibility");
    case "menubar":
      return snap.trayVisible || skipped("menubar");
    case "model":
      return snap.modelReady;
    case "try":
      return false; // always shown last; Finish is the only exit
  }
}

/** The step the wizard must show: the first whose gate is unmet. */
export function firstUnmetStep(snap: GateSnapshot, skips: readonly string[]): StepId {
  const steps = stepsFor(snap.platform);
  for (const step of steps) {
    if (!gateMet(step, snap, skips)) return step;
  }
  return "try";
}

/** Public gate check (SPEC5: Continue enablement and transition detection). */
export function stepMet(step: StepId, snap: GateSnapshot, skips: readonly string[]): boolean {
  return gateMet(step, snap, skips);
}
