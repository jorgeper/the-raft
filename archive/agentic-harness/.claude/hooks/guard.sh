#!/bin/bash
# PreToolUse guard: blocks the moves agents must never make, even when a
# permission rule missed a variant. Konishi's mechanic: ONLY exit 2 blocks —
# exit 0 merely logs and proceeds.
#
# Blocked, always:
#   - pushing to main/master (any remote)
#   - merging PRs (gh pr merge)
#   - force pushes
#   - hard resets against main/master
#
# Test it (spec §17.10):
#   echo '{"tool_input":{"command":"git push origin main"}}' | .claude/hooks/guard.sh
#   -> exit 2

input=$(cat)

cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
if [ -z "$cmd" ]; then
  # Not a shell command (or no jq available and nothing to parse) — let it pass;
  # permission rules still apply.
  exit 0
fi

if printf '%s' "$cmd" | grep -qE \
  'git[[:space:]]+push[^|;&]*[[:space:]](main|master)([[:space:]]|$)|gh[[:space:]]+pr[[:space:]]+merge|git[[:space:]]+push[^|;&]*[[:space:]]--force|git[[:space:]]+push[^|;&]*[[:space:]]-f([[:space:]]|$)|git[[:space:]]+reset[[:space:]]+--hard[[:space:]]+(origin/)?(main|master)'; then
  echo "BLOCKED by guard.sh: $cmd" >&2
  echo "agents never push to main, never merge, never force-push (AGENTS.md)" >&2
  exit 2
fi

exit 0
