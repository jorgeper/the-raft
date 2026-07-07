---
name: spec-writing
description: Write testable requirements and specs. Use when drafting or revising a PRD or design spec.
---

# Writing specs that survive contact with a verifier

A requirement is good when two strangers — or one harness — reach the same pass/fail
conclusion without discussing it.

## The one rule

Every requirement names an observable behavior and its trigger. The template:
**When X, the system does Y, observable by Z.**

Bad → good:

- "handles errors gracefully" → "returns 400 with `{"error": "<field> is required"}`
  when a required field is missing"
- "fast" → "GET /todos p95 under 100ms with 1,000 items"
- "secure login" → "5 failed attempts within 10 minutes locks the account for 15
  minutes and returns 429"

## Structure

- Number requirements so feedback can say "loosen R4", not "the part about errors".
- Separate functional from non-functional; non-functional still needs numbers.
- "Out of scope" is load-bearing: everything ambiguous either becomes a requirement,
  an out-of-scope line, or an open question. Silence is how scope creeps.
- Keep one page. If it doesn't fit, the feature is too big — say so.

## Revision rounds

When a human comments on your draft, respond point by point: quote or reference each
piece of feedback and show what changed (or argue back, briefly). A revision that
silently ignores one comment costs more trust than a wrong first draft.

## Smells

- A requirement with "should", "appropriate", "robust", or "user-friendly" in it.
- A requirement that can't fail. If no input could violate it, it isn't a requirement.
- Two requirements that can't both be true; find them before the architect does.
