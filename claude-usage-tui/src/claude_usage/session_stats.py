"""Per-session (per transcript file) statistics for the Sessions tab."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from pathlib import Path

from claude_usage.pricing import cost_usd
from claude_usage.transcripts import Record


@dataclass
class SessionStats:
    first_ts: datetime
    last_ts: datetime
    prompts: int = 0
    cost_usd: float = 0.0
    output_tokens: int = 0
    model: str = ""
    git_branch: str = ""
    cwd: str = ""
    context_tokens: int = 0  # latest main-chain call's context
    subagent_calls: int = 0
    last_tool: str = ""
    _last_main_ts: datetime | None = field(default=None, repr=False)

    @property
    def duration(self) -> timedelta:
        return self.last_ts - self.first_ts


def session_stats(records: list[Record]) -> dict[Path, SessionStats]:
    stats: dict[Path, SessionStats] = {}
    for rec in records:
        if rec.source is None:
            continue
        s = stats.get(rec.source)
        if s is None:
            s = stats[rec.source] = SessionStats(first_ts=rec.timestamp, last_ts=rec.timestamp)
        s.first_ts = min(s.first_ts, rec.timestamp)
        s.last_ts = max(s.last_ts, rec.timestamp)

        if rec.kind == "prompt":
            s.prompts += 1
            continue
        s.cost_usd += cost_usd(rec)
        s.output_tokens += rec.output_tokens
        if rec.is_sidechain:
            s.subagent_calls += 1
            continue
        # Main-chain state tracks the *latest* call, records may arrive unordered.
        if s._last_main_ts is None or rec.timestamp >= s._last_main_ts:
            s._last_main_ts = rec.timestamp
            s.context_tokens = rec.context_tokens
            if rec.model:
                s.model = rec.model
            if rec.git_branch:
                s.git_branch = rec.git_branch
            if rec.cwd:
                s.cwd = rec.cwd
            if rec.tools:
                s.last_tool = rec.tools[-1]
    return stats
