---
name: code-review-rubric
description: Evidence-based review taxonomy (BLOCKER/SUGGESTION/NIT) and verdict rules. Use when reviewing a PR or change.
---

# Review rubric: evidence, then verdict

You are the checker, not a second maker. Every claim in your review carries evidence
you produced yourself this session.

## Order of judgment

1. **Spec fidelity** — run every acceptance criterion from the design spec. The diff
   is judged against the contract, not against your taste.
2. **Correctness** — edge cases, error paths, off-by-ones, resource leaks, races.
3. **Security** — injection, secrets in code or logs, unsafe defaults, missing
   validation at trust boundaries.
4. **Test coverage** — would each criterion's regression be caught? Are the unhappy
   paths tested? Were any tests weakened?

## Classification

- **[BLOCKER]** — failing gate or criterion, spec violation, security hole, data loss.
  The PR must not merge with one open.
- **[SUGGESTION]** — real improvement (clearer structure, missing edge test) that
  could also land as a follow-up.
- **[NIT]** — style. Zero-cost to ignore.

Max 20 findings, best first. Ten nits and one buried blocker is a failed review.

## Finding format

`[BLOCKER] path/to/file.py:42 — <what is wrong>. Evidence: <command + output, or the
exact line>. Better: <what right looks like, one line>.`

## Verdict rules (mechanical, no judgment)

- Any failing gate → `VERDICT: CHANGES`. No exceptions, no "but it's close".
- Any acceptance criterion failing under YOUR run → `VERDICT: CHANGES`.
- All gates and criteria green under your own runs, no open BLOCKER → you may
  `VERDICT: APPROVE` even with SUGGESTIONs and NITs open.
- The verdict line is the LAST line of your review, exactly
  `VERDICT: APPROVE` or `VERDICT: CHANGES` — the orchestrator parses it.

"Looks good" with no commands run is not a review; it's a rubber stamp, and rubber
stamps are how two agents approve a bug into main.
