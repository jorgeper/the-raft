#!/bin/bash
# PostToolUse audit: one JSONL line per tool call. Cheap insurance — this is how
# you answer "what did the agents do on Tuesday?" (field guide §3) and how the
# curator (v2) spots runaway loops. .agent-logs/ is gitignored.

mkdir -p .agent-logs

if command -v jq >/dev/null 2>&1; then
  cat | jq -c '{ts: now | todate, tool: .tool_name, input: .tool_input}' \
    >> .agent-logs/audit.jsonl 2>/dev/null
else
  # Degraded but still useful: raw event with a timestamp prefix.
  printf '{"ts":"%s","raw":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(cat | tr -d '\n')" \
    >> .agent-logs/audit.jsonl 2>/dev/null
fi

exit 0
