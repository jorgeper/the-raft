# SPEC5: Numshub — wizard navigation and full re-walk

An increment over SPEC.md/SPEC2.md/SPEC3.md/SPEC4.md (authoritative
elsewhere). The setup wizard gains backward navigation for reviewing
instructions — including steps that are already satisfied — and "Re-run
setup" becomes a full walkthrough from the top. Forward movement remains
gate-verified everywhere: navigation must never weaken SPEC2's model.

## 1. Concepts (FR-N1)

- **Frontier**: the first unmet gate, as SPEC2 §3 already computes it
  (`firstUnmetStep`). Everything at-or-before the frontier is navigable;
  everything past it is not.
- **Pinned**: session-only UI state meaning "the user navigated here
  deliberately — do not auto-advance out from under them." Never persisted;
  a relaunch mid-wizard still resumes per SPEC2 §3.
- **Review mode**: how a met step renders (see §3). Not a separate screen —
  the same step component with its satisfied status.

## 2. Navigation controls (FR-N2)

1. **Back**: a quiet "‹ Back" control on every step after the first, moving
   one step backward in the platform's step order. Always available,
   including from the Try It screen.
2. **Clickable progress dots**: dots for steps at-or-before the frontier
   navigate on click and show the step name on hover (title attribute is
   enough). Dots past the frontier are inert and visually unchanged.
3. Navigating via back/dots sets `pinned`.
4. **No-yank rule**: while pinned, the live polling continues (chips stay
   truthful) but automatic forward advancement is suppressed. The pin
   releases only on the user's own navigation (Continue / dots / Back).
5. On an unmet gate, pinned or not, behavior is exactly today's: Continue
   stays disabled until the gate verifies.

## 3. Review mode for met steps (FR-N3)

When the user is on a step whose gate is already met:

- The step's full instruction text is ALWAYS visible — this is the point of
  the feature. (Today Menu Bar and Accessibility hide their how-to once
  satisfied; stop hiding it. Model shows its chooser copy with the active
  model named.)
- The status chip shows the satisfied state ("Granted ✓", "Visible ✓", …).
- The step's primary action (Open System Settings, etc.) stays available —
  reopening the settings pane is legitimately useful.
- Skip/defer buttons are hidden (moot when met).
- The primary button is **Continue** → the NEXT step in order (sequential
  walkthrough). When the frontier is more than one step ahead, ALSO show a
  secondary "Jump to where I left off" link → the frontier. (Covers both
  the review-everything walk and the quick peek-back-then-return.)

## 4. Entry points (FR-N4)

1. **Launch resume** (app starts with onboarding incomplete): unchanged —
   opens at the frontier (SPEC2 §3; E9e must keep passing).
2. **Fix in setup** (SPEC4 surfaces): unchanged — opens at the frontier,
   which is the broken gate.
3. **Re-run setup** (Settings → General): NOW opens at **Welcome** and walks
   the full sequence. Met steps render in review mode and Continue through;
   unmet gates gate as always. Implemented as session-only intent (e.g. a
   `startAtWelcome` flag passed to the wizard) — nothing persisted, no
   stored step index; if the app relaunches mid-re-walk, plain frontier
   resume applies (document this in the code, it is intentional).
4. Re-run continues to clear all deferrals (SPEC4 behavior), so previously
   deferred gates are genuinely re-checked during the walk.

## 5. Structure (FR-N5)

The navigation rules (visited/frontier/pinned/next-step/jump-target) live in
a pure function or tiny reducer in `src/lib/onboarding.ts` (or a sibling),
NOT inside the component — U7 tests it exhaustively. The wizard component
consumes it; gate resolution (`firstUnmetStep`) is unchanged.

## 6. Tests

- **U7**: the navigation logic — back targets per step order and platform;
  dot clickability strictly bounded by the frontier; pinned suppresses
  auto-advance; Continue-from-met-step targets the next step; jump-target
  is the frontier and only offered when frontier > next; welcome-start
  intent produces "welcome" regardless of met gates.
- **E12a**: mid-setup back-and-return — in onboarding with mic granted (on
  accessibility), Back → microphone shows review mode (instructions +
  "Granted ✓" + no defer buttons); granting nothing, the wizard stays put
  (no yank); Continue returns to accessibility.
- **E12b**: dots — from the model step, click the microphone dot → review
  mode; dots past the frontier do nothing.
- **E12c**: re-run walkthrough — configured healthy app, Settings → General
  → Re-run setup → wizard opens at **welcome**; Continue walks
  microphone → accessibility → menubar → model, each showing its met/review
  state without gating; finishes at Try It with all rows green.
- **E12d**: no-yank — pinned on a met step while a background grant flips
  another gate; the visible step does not change until the user acts.
- Existing suites — especially E9e (launch resume at frontier) and E11a–d
  (Fix in setup lands on the broken gate) — keep passing unmodified.

## 7. Definition of Done

1. `npm run validate` exits 0 with complete output — all existing suites
   plus U7 and E12a–d — ending `VALIDATION: ALL PASSED`, printed in the
   transcript.
2. `npm run tauri build` exits 0; .app path + size (< 80 MB) printed.
3. `grep -rn ".skip\|.only\|.todo" tests/` prints nothing (phrase test names
   with "deferral"/"bypass"/"re-check").
4. README: two sentences in the setup section — you can go back and review
   any step, and Re-run setup walks everything from the top.
5. Anything infeasible → BLOCKERS.md; never game a check.

Manual check after green: Re-run setup on a fully configured app — every
screen appears from Welcome onward in its green state with instructions
readable; Back and the dots move freely; nothing ever auto-advances while
reading; a genuinely broken gate still blocks Continue.
