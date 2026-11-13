"""Console configuration: which studio to watch, and how eagerly."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yaml


@dataclass(frozen=True)
class ConsoleConfig:
    studio_root: Path
    studio_python: Path
    events_poll_ms: int = 250
    snapshot_poll_s: int = 5

    @property
    def events_path(self) -> Path:
        return self.studio_root / ".agent-logs" / "events.jsonl"

    @property
    def runs_dir(self) -> Path:
        return self.studio_root / "runs"


def load_config(path: Path | str = "config.yaml") -> ConsoleConfig:
    path = Path(path)
    raw = yaml.safe_load(path.read_text()) if path.is_file() else {}
    studio = (raw or {}).get("studio", {})
    poll = (raw or {}).get("poll", {})
    base = path.resolve().parent
    root = Path(studio.get("root", "../agent-studio"))
    python = Path(studio.get("python", "../agent-studio/.venv/bin/python"))
    return ConsoleConfig(
        studio_root=(base / root).resolve() if not root.is_absolute() else root,
        studio_python=(base / python).resolve() if not python.is_absolute() else python,
        events_poll_ms=int(poll.get("events_ms", 250)),
        snapshot_poll_s=int(poll.get("snapshot_s", 5)),
    )
