"""Board/item snapshots via the studio CLI contract — `status --json` and
`show <id> --json`. All subprocess calls go through one injected seam."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RunResult:
    returncode: int
    stdout: str
    stderr: str


def run_command(argv: list[str], cwd: Path | None = None, timeout_s: int = 30) -> RunResult:
    try:
        proc = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=timeout_s)
        return RunResult(proc.returncode, proc.stdout, proc.stderr)
    except (subprocess.TimeoutExpired, FileNotFoundError) as exc:
        return RunResult(127, "", str(exc))


class SnapshotClient:
    def __init__(self, studio_root: Path, studio_python: Path, runner=run_command) -> None:
        self.studio_root = Path(studio_root)
        self.studio_python = Path(studio_python)
        self.runner = runner

    def _studio(self, *args: str) -> dict | None:
        result = self.runner(
            [str(self.studio_python), "-m", "studio",
             "--config", str(self.studio_root / "config" / "studio.yaml"), *args],
            cwd=self.studio_root,
        )
        if result.returncode != 0:
            return None
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError:
            return None

    def status(self) -> dict | None:
        return self._studio("status", "--json")

    def show(self, item_id: str) -> dict | None:
        return self._studio("show", item_id, "--json")
