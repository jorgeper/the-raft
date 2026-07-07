#!/bin/bash
# PostToolUse audit: one JSONL line per tool call. Cheap insurance — this is how
# you answer "what did the agents do on Tuesday?" (field guide §3) and how a
# curator (v2) spots runaway loops or config drift. Always exits 0: auditing
# must never block work; only guard.sh blocks.
#
# Input (stdin, from Claude Code): a JSON event with at least
#   tool_name   — e.g. "Bash", "Edit", "Write"
#   tool_input  — the tool's arguments (for Bash: {"command": "..."})
# We keep only ts/tool/input; add fields here if an incident ever leaves you
# wishing you had them (that is how this file grows, and the only way it should).
#
# Output: .agent-logs/audit.jsonl (gitignored), rotated at ~5MB so an overnight
# watch loop can't fill the disk. blocked commands land in blocked.log via
# guard.sh. Inspect the trail with:
#   jq -r '[.ts, .tool] | @tsv' .agent-logs/audit.jsonl | sort | uniq -c
#   jq -r 'select(.tool=="Bash") | .input.command' .agent-logs/audit.jsonl | tail

LOG_DIR=.agent-logs
LOG="$LOG_DIR/audit.jsonl"
MAX_BYTES=5242880

mkdir -p "$LOG_DIR" 2>/dev/null || exit 0

# Rotate: keep exactly one previous generation; the audit trail is insurance,
# not an archive — runs/ holds the full per-dispatch record.
if [ -f "$LOG" ]; then
  size=$(wc -c < "$LOG" 2>/dev/null || echo 0)
  if [ "${size:-0}" -gt "$MAX_BYTES" ]; then
    mv "$LOG" "$LOG.1" 2>/dev/null
  fi
fi

if command -v jq >/dev/null 2>&1; then
  cat | jq -c '{ts: now | todate, tool: .tool_name, input: .tool_input}' \
    >> "$LOG" 2>/dev/null
else
  # Degraded but still useful: raw event with a timestamp prefix.
  printf '{"ts":"%s","raw":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(cat | tr -d '\n')" \
    >> "$LOG" 2>/dev/null
fi

exit 0
