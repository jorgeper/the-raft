"""Console configuration: which blacksun to watch, and how eagerly."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass(frozen=True)
class ConsoleConfig:
    blacksun_root: Path
    blacksun_python: Path
    events_poll_ms: int = 250
    snapshot_poll_s: int = 5

    @property
    def events_path(self) -> Path:
        return self.blacksun_root / ".agent-logs" / "events.jsonl"

    @property
    def runs_dir(self) -> Path:
        return self.blacksun_root / "runs"


def load_config(path: Path | str = "config.yaml") -> ConsoleConfig:
    path = Path(path)
    raw = yaml.safe_load(path.read_text()) if path.is_file() else {}
    blacksun = (raw or {}).get("blacksun", {})
    poll = (raw or {}).get("poll", {})
    base = path.resolve().parent
    root = Path(blacksun.get("root", ".."))
    python = Path(blacksun.get("python", "../.venv/bin/python"))
    return ConsoleConfig(
        blacksun_root=(base / root).resolve() if not root.is_absolute() else root,
        blacksun_python=(base / python).resolve() if not python.is_absolute() else python,
        events_poll_ms=int(poll.get("events_ms", 250)),
        snapshot_poll_s=int(poll.get("snapshot_s", 5)),
    )
