"""ModelRuntime: how an agent's prompt gets executed by a coding-agent CLI."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RuntimeResult:
    output: str
    exit_code: int
    duration_s: float = 0.0
    cost_usd: float | None = None

    @property
    def ok(self) -> bool:
        return self.exit_code == 0


class ModelRuntime(ABC):
    name: str = "base"

    @abstractmethod
    def run(
        self,
        prompt: str,
        *,
        cwd: Path,
        timeout_s: int = 3600,
        agent: str | None = None,
    ) -> RuntimeResult:
        """Execute one fresh-context invocation. `agent` selects a native
        subagent definition where the runtime supports it (Claude Code)."""

    @abstractmethod
    def available(self) -> bool:
        """Is the backing CLI plausibly usable on this machine?"""
