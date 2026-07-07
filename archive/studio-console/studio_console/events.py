"""Event parsing for the Agent Studio observability contract (v1).

Forward-compatible by design: unknown kinds parse fine and render raw; a version
mismatch is flagged, not fatal. See agent-studio/docs/architecture/07-observability.md.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field

SUPPORTED_VERSION = 1

KNOWN_KINDS = frozenset(
    {
        "tick_start",
        "tick_end",
        "dispatch_start",
        "dispatch_end",
        "runtime_start",
        "runtime_end",
        "agent_output",
        "loop_start",
        "iteration_start",
        "gate_result",
        "task_passed",
        "guardrail_added",
        "loop_exit",
        "item_created",
        "transition",
        "comment_added",
        "claimed",
        "released",
    }
)


@dataclass(frozen=True)
class Event:
    v: int
    seq: int
    ts: str
    kind: str
    item: str | None
    agent: str | None
    data: dict = field(default_factory=dict)

    @property
    def known(self) -> bool:
        return self.kind in KNOWN_KINDS

    @property
    def version_ok(self) -> bool:
        return self.v == SUPPORTED_VERSION

    def one_line(self) -> str:
        """Compact feed rendering: time, kind, item, agent, salient datum."""
        clock = self.ts.split("T")[1].split("+")[0] if "T" in self.ts else self.ts
        where = f"#{self.item}" if self.item else ""
        who = self.agent or ""
        salient = _salient(self.kind, self.data)
        return " ".join(p for p in (clock, self.kind, where, who, salient) if p)


def _salient(kind: str, data: dict) -> str:
    if kind == "transition":
        return f"{data.get('from', '?')} → {data.get('to', '?')} ({data.get('actor', '?')})"
    if kind == "gate_result":
        return f"{'ok' if data.get('ok') else 'FAIL'} $ {data.get('command', '')}"
    if kind == "task_passed":
        return f"{data.get('task_id')} ({data.get('tasks_passed')}/{data.get('tasks_total')})"
    if kind == "loop_exit":
        return f"{data.get('reason')} after {data.get('iterations')} iterations"
    if kind == "iteration_start":
        return f"iter {data.get('n')} task={data.get('task_id') or 'planning'}"
    if kind == "comment_added":
        return f"by {data.get('author')} ({data.get('chars')} chars)"
    if kind == "dispatch_end":
        return f"{data.get('action', '')} {data.get('detail', '')}".strip()
    if kind == "runtime_end":
        return f"exit {data.get('exit_code')} in {data.get('duration_s')}s"
    if kind == "guardrail_added":
        return str(data.get("trigger", ""))[:60]
    if kind == "loop_start":
        return f"{data.get('tasks_passed', 0)}/{data.get('tasks_total', 0)} tasks at start"
    if kind == "agent_output":
        chunk = str(data.get("chunk", ""))[:60].replace("\n", " ")
        return f"[{data.get('channel', 'text')}] {chunk}" + (" ⏹" if data.get("done") else "")
    return ""


def parse_line(line: str) -> Event | None:
    """One JSONL line -> Event. Returns None for blank lines; raises ValueError
    on malformed input (callers count errors, they don't crash)."""
    line = line.strip()
    if not line:
        return None
    try:
        raw = json.loads(line)
    except json.JSONDecodeError as exc:
        raise ValueError(f"malformed event line: {exc}") from exc
    if not isinstance(raw, dict) or "kind" not in raw:
        raise ValueError("event line is not an object with a 'kind'")
    return Event(
        v=int(raw.get("v", 0)),
        seq=int(raw.get("seq", 0)),
        ts=str(raw.get("ts", "")),
        kind=str(raw["kind"]),
        item=raw.get("item"),
        agent=raw.get("agent"),
        data=raw.get("data") or {},
    )
