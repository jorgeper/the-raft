// Wizard navigation rules (SPEC5 §5, U7-tested). Pure functions over the
// platform step order and the live frontier (firstUnmetStep). The component
// consumes these; gate resolution itself is untouched.

import { stepsFor, type StepId } from "./onboarding";

function indexOf(step: StepId, platform: string): number {
  return stepsFor(platform).indexOf(step);
}

/** One step backward in order; null on the first step. */
export function backTarget(current: StepId, platform: string): StepId | null {
  const steps = stepsFor(platform);
  const i = steps.indexOf(current);
  return i > 0 ? steps[i - 1] : null;
}

/** One step forward in order; null on the last step. */
export function nextStep(current: StepId, platform: string): StepId | null {
  const steps = stepsFor(platform);
  const i = steps.indexOf(current);
  return i >= 0 && i < steps.length - 1 ? steps[i + 1] : null;
}

/** Navigation is allowed at-or-before the frontier, never past it. */
export function canNavigateTo(target: StepId, frontier: StepId, platform: string): boolean {
  const t = indexOf(target, platform);
  const f = indexOf(frontier, platform);
  return t >= 0 && f >= 0 && t <= f;
}

/**
 * "Jump to where I left off": offered only when the frontier is further ahead
 * than the very next step (otherwise Continue already goes there).
 */
export function jumpTarget(
  current: StepId,
  frontier: StepId,
  platform: string,
): StepId | null {
  const next = nextStep(current, platform);
  if (!next) return null;
  return indexOf(frontier, platform) > indexOf(next, platform) ? frontier : null;
}

/** A step strictly before the frontier renders in review mode (SPEC5 §3). */
export function isReview(current: StepId, frontier: StepId, platform: string): boolean {
  return indexOf(current, platform) < indexOf(frontier, platform);
}

/** Where the wizard opens (SPEC5 §4): re-run walks from the top. */
export function initialStep(intent: "frontier" | "welcome", frontier: StepId): StepId {
  return intent === "welcome" ? "welcome" : frontier;
}

/**
 * Pinned = the user navigated somewhere deliberately; auto-advance is
 * suppressed. Any position strictly before the frontier is pinned territory.
 */
export function isPinned(current: StepId, frontier: StepId, platform: string): boolean {
  return isReview(current, frontier, platform);
}
