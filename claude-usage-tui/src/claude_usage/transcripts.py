"""Parse Claude Code transcript JSONL lines into usage/prompt records."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path


@dataclass
class Record:
    kind: str  # "usage" | "prompt"
    timestamp: datetime
    model: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_create_5m_tokens: int = 0
    cache_create_1h_tokens: int = 0
    dedup_key: tuple[str, str] = field(default=("", ""))
    cwd: str = ""
    git_branch: str = ""
    tools: list[str] = field(default_factory=list)
    is_sidechain: bool = False
    source: Path | None = None  # transcript file = session identity

    @property
    def context_tokens(self) -> int:
        """Tokens the model saw on this call (fresh input + all cache tiers)."""
        return (
            self.input_tokens
            + self.cache_read_tokens
            + self.cache_create_5m_tokens
            + self.cache_create_1h_tokens
        )


def _parse_ts(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError, TypeError):
        return None


def parse_line(line: str) -> Record | None:
    try:
        data = json.loads(line)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict):
        return None

    ts = _parse_ts(data.get("timestamp"))
    if ts is None:
        return None

    kind = data.get("type")
    message = data.get("message") or {}

    if kind == "assistant":
        usage = message.get("usage")
        if not usage:
            return None
        cache_create = usage.get("cache_creation") or {}
        content = message.get("content")
        tools = (
            [b.get("name", "") for b in content if isinstance(b, dict) and b.get("type") == "tool_use"]
            if isinstance(content, list)
            else []
        )
        return Record(
            kind="usage",
            timestamp=ts,
            model=message.get("model", ""),
            cwd=data.get("cwd", ""),
            git_branch=data.get("gitBranch", ""),
            tools=tools,
            is_sidechain=bool(data.get("isSidechain")),
            input_tokens=usage.get("input_tokens", 0),
            output_tokens=usage.get("output_tokens", 0),
            cache_read_tokens=usage.get("cache_read_input_tokens", 0),
            cache_create_5m_tokens=cache_create.get("ephemeral_5m_input_tokens", 0),
            cache_create_1h_tokens=cache_create.get("ephemeral_1h_input_tokens", 0),
            dedup_key=(message.get("id", ""), data.get("requestId", "")),
        )

    if kind == "user":
        # A "prompt" is something the user actually typed: not a tool result,
        # not a sidechain (subagent) turn.
        if data.get("toolUseResult") is not None or data.get("isSidechain"):
            return None
        return Record(kind="prompt", timestamp=ts)

    return None
