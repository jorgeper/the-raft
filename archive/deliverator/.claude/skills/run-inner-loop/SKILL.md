---
name: run-inner-loop
description: Use this before opening any pull request or declaring implementation done. Defines the exact local validation sequence (install, lint, test) that must pass in a sandbox, and what to do on failure. Do not open a PR until this is green — apply it on every implementation task.
allowed-tools: Bash, Read, Edit
---

# The inner loop (local validation)

Run these IN ORDER. Do not skip. Do not open a PR unless all pass.

1. `make install` — install the package and dev deps.
2. `make lint` — fix issues; re-run.
3. `make test` — all tests pass, including new ones for this change.

## If a step fails
- Read the actual error. Fix the root cause; do NOT delete or weaken tests to force green.
- Re-run the full sequence from step 1 after any fix.
- If it fails 3+ times on the same error, stop and summarize the blocker instead of thrashing.

## Sandbox
- Run in the isolated container/worktree, never the host.

## Done means
- install + lint + test all green in a clean run, and the change is covered by a test that would fail without it.
