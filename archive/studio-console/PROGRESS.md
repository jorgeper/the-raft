# Build progress — Observability + Studio Console

Resume protocol: read this + `git log --oneline -10` + spec.md §6/§8. The verify
score (scripts/verify.sh, 9 checks) must never decrease.

## Current

- **Milestone:** scaffolding done → starting O1 (events in agent-studio)
- **verify.sh score:** not yet runnable end to end (baseline after O1)
- Console venv: textual 8.2.8, rich 15.0.0 (both newer than training data — check
  APIs via context7 before writing app code)

## Done

- Scaffolding: folders, .venv, pyproject (pytest asyncio_mode=auto), Makefile,
  scripts/verify.sh (all 9 checks implemented up front).

## Next

- O1: studio/events.py (EventLog/NullEventLog, seq, rotation, tails) + emission in
  orchestrator/loop/trackers + tests/test_events.py in agent-studio.
- O2: status --json, show <id> --json, demo --keep (+ config/studio.yaml written
  into the demo sandbox so snapshot commands work there), contract doc 07, add to
  verify-docs manifest, regenerate fixtures.

## Gotchas

- agent-studio demo sandbox path is printed as "sandbox: <path>"; verify.sh check 4
  parses that line — keep it stable when touching demo output.
- verify.sh check 5 needs the demo sandbox to contain studio/config/studio.yaml.
