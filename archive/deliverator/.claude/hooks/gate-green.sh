#!/bin/bash
# Stop gate for coder runs: block ending the turn while the build is red.
# Exit 2 = block (stderr goes back to the agent); Claude Code force-releases
# after 8 consecutive blocks, so a hopeless task still terminates.
#
# Only active when the orchestrator marks the run — interactive sessions and
# non-coder roles are never gated.
[ "$DELIVERATOR_CODER" = "1" ] || exit 0
# Nothing to gate yet (fresh repo before the app exists) — let it through.
[ -f Makefile ] || exit 0

out=$(make lint 2>&1) || {
  echo "Stop gate: make lint is RED — fix before finishing:" >&2
  echo "$out" | tail -20 >&2
  exit 2
}
out=$(make test 2>&1) || {
  echo "Stop gate: make test is RED — fix before finishing:" >&2
  echo "$out" | tail -20 >&2
  exit 2
}
exit 0
