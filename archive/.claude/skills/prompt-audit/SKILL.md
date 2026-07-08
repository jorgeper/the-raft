---
name: prompt-audit
description: Read a scorecard, diagnose an agent failure pattern from run transcripts, and write a minimal prompt diff
---

# Auditing an agent prompt against its scorecard

A prompt change is a hypothesis about behavior. This skill is how to form one
worth testing: evidence first, one variable at a time, falsifiable claim.

## Reading the scorecard

- `coder.iterations_per_verified` rising — the coder wanders: look for missing
  orientation steps, vague task decomposition, or gates it forgot to run.
- `coder.escalation_rate` rising — budgets blow or the same error repeats:
  look at `.loop/progress.md` tails in the run dirs for the repeated failure.
- `coder.review_rounds_per_item` rising — blockers that should have been caught
  before the PR: usually a missing self-check in the coder prompt, not a
  reviewer problem.
- `reviewer.disagreement_rate` rising — the two reviewers apply different bars:
  the rubric language is ambiguous somewhere; find the finding class they split on.
- `prd/architect.first_pass_approval_rate` falling — the human keeps bouncing
  drafts: read the human's re-draft comments for what was missing.

## Diagnosing

1. Open the run dirs the item body points at; read output.md, not just the
   scorecard number.
2. Grep the role journal for repeated lessons — three similar LESSON lines are
   a prompt gap the agent already knows about.
3. Write the pattern as one sentence: "When X, the agent does Y, costing Z."
   If you cannot, you do not have a pattern yet.

## Writing the diff

- One edit, one metric, one claim. A diff that "also improves" something else
  is two proposals.
- Add the missing instruction where the agent failed to look: orientation
  problems go in "How you work", output problems in the output contract,
  discipline problems as one line in NEVER.
- Keep the surgical form: prefer `+` lines over rewritten paragraphs; the human
  reviews the diff, and a small diff gets approved.
- Never delete or soften NEVER lines, stop rules, or output contracts.
- State the expected movement honestly. If the metric could not plausibly move
  within `improve_every` items, the regression guard cannot judge it — pick a
  faster-moving metric or skip.

## Traps

- Chasing a one-item blip: a single bad run is noise; a pattern appears in ≥2
  covered items or ≥3 journal lessons.
- Prompt bloat: every added sentence dilutes the others. If the prompt already
  says it, the fix is sharpening the existing line, not adding a twin.
- Untestable claims: "EXPECT: coder.quality increase" is not a metric. Only
  scorecard metrics count.
