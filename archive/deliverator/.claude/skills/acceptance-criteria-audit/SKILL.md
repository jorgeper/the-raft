---
name: acceptance-criteria-audit
description: Use this when reviewing a pull request or diff for correctness against a spec or DESIGN.md. Provides a repeatable procedure to extract every acceptance criterion and prove each is covered by a real test — catching the most common failure, a passing suite that silently omits the dangerous case. Use it on every correctness review.
allowed-tools: Read, Grep
---

# Acceptance-criteria audit

Green tests are not enough — verify the RIGHT things are tested.

## Procedure
1. Extract every acceptance criterion from the spec/DESIGN.md and the issue. List them as a checklist.
2. For EACH criterion, locate the specific test(s) that prove it. Cite file + test name.
3. Mark each **COVERED** (cite the test) or **MISSING** (no test proves it).
4. Pay special attention to:
   - Boundary values on BOTH sides (max accepted AND max+1 rejected).
   - Failure/negative paths (invalid input rejected; unauthorized request rejected).
   - Anything security-relevant (authorization on protected routes).

## Output
- `## Criteria coverage` — checklist with COVERED/MISSING and test citations.
- `## Findings` — logic bugs or gaps.
- `## Verdict` — LGTM only if EVERY criterion is COVERED; otherwise CHANGES with the exact missing tests.

## Rule
Read-only. Do not edit the code you are reviewing. Report; the coder fixes.
