"""Active local sessions: recently-touched transcripts + running claude processes."""

from __future__ import annotations

import json
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Session:
    cwd: str
    idle_seconds: float
    path: Path


def _cwd_from_tail(path: Path) -> str:
    """Read the cwd field from the last parseable lines of a transcript."""
    try:
        with path.open("rb") as fh:
            fh.seek(max(0, path.stat().st_size - 16384))
            tail = fh.read().decode("utf-8", errors="replace")
    except OSError:
        return ""
    for raw in reversed(tail.splitlines()):
        try:
            cwd = json.loads(raw).get("cwd")
        except (json.JSONDecodeError, AttributeError):
            continue
        if cwd:
            return cwd
    return ""


def recent_sessions(root: Path, max_age_seconds: float = 600) -> list[Session]:
    now = time.time()
    sessions = []
    for path in root.glob("*/*.jsonl"):
        try:
            idle = now - path.stat().st_mtime
        except OSError:
            continue
        if idle <= max_age_seconds:
            sessions.append(Session(cwd=_cwd_from_tail(path), idle_seconds=idle, path=path))
    sessions.sort(key=lambda s: s.idle_seconds)
    return sessions


def count_claude_processes() -> int:
    try:
        out = subprocess.run(
            ["ps", "-axo", "command"], capture_output=True, text=True, timeout=10
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return 0
    count = 0
    for line in out.splitlines():
        cmd = line.strip()
        head = cmd.split(" ", 1)[0].rsplit("/", 1)[-1]
        if head == "claude" or (head == "node" and "/claude" in cmd):
            count += 1
    return count
