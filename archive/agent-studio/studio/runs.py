"""Run persistence: every dispatch gets a runs/<timestamp>-<item>-<agent>/ directory
holding prompts, outputs, and gate reports — resumable, diffable, greppable."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path


class RunDir:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.mkdir(parents=True, exist_ok=True)

    def save(self, name: str, content: str) -> Path:
        target = self.path / name
        target.write_text(content)
        return target

    def append_journal(self, line: str) -> None:
        stamp = datetime.now(UTC).isoformat(timespec="seconds")
        with (self.path / "journal.md").open("a") as fh:
            fh.write(f"- {stamp} {line}\n")


class RunStore:
    def __init__(self, root: Path) -> None:
        self.root = Path(root)

    def new_run(self, item_id: str, agent: str) -> RunDir:
        stamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%S")
        base = self.root / f"{stamp}-{item_id}-{agent}"
        path, n = base, 1
        while path.exists():  # same-second collisions
            path = Path(f"{base}-{n}")
            n += 1
        return RunDir(path)
