#!/bin/bash
# PreToolUse guard: blocks the moves agents must never make, even when a
# permission rule missed a variant. Konishi's mechanic: ONLY exit 2 blocks —
# exit 0 merely logs and proceeds. Enforcement lives here and in settings.json;
# AGENTS.md is advisory only.
#
# Blocked, always:
#   - pushing to main/master (any remote, any flag order)
#   - merging or force-closing PRs (gh pr merge)
#   - force pushes (--force, -f)
#   - hard resets against main/master
#   - repo-destroying deletes (rm -rf on ., .git, or an absolute repo root)
#
# Test it (spec §17.10):
#   echo '{"tool_input":{"command":"git push origin main"}}' | .claude/hooks/guard.sh
#   -> exit 2, and the block is recorded in .agent-logs/blocked.log

input=$(cat)

cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)
if [ -z "$cmd" ]; then
  # Not a shell command (or jq unavailable and nothing to parse) — let it pass;
  # permission rules still apply to non-Bash tools.
  exit 0
fi

block() {
  mkdir -p .agent-logs
  printf '%s BLOCKED (%s): %s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$cmd" >> .agent-logs/blocked.log 2>/dev/null
  echo "BLOCKED by guard.sh ($1): $cmd" >&2
  echo "agents never push to main, never merge, never force-push (AGENTS.md)" >&2
  exit 2
}

if printf '%s' "$cmd" | grep -qE \
  'git[[:space:]]+push[^|;&]*[[:space:]](main|master)([[:space:]]|$)'; then
  block "push-to-main"
fi

if printf '%s' "$cmd" | grep -qE 'gh[[:space:]]+pr[[:space:]]+merge'; then
  block "pr-merge"
fi

if printf '%s' "$cmd" | grep -qE \
  'git[[:space:]]+push[^|;&]*[[:space:]](--force|--force-with-lease|-f)([[:space:]]|$)'; then
  block "force-push"
fi

if printf '%s' "$cmd" | grep -qE \
  'git[[:space:]]+reset[[:space:]]+--hard[[:space:]]+(origin/)?(main|master)'; then
  block "hard-reset-main"
fi

if printf '%s' "$cmd" | grep -qE \
  'rm[[:space:]]+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)[[:space:]]+(/|\.git|\.($|[[:space:]]))'; then
  block "destructive-rm"
fi

exit 0
