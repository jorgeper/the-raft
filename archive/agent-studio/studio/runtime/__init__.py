"""Runtime factory."""

from __future__ import annotations

from studio.config import RuntimeConfig
from studio.execution import CommandExecutor
from studio.runtime.base import ModelRuntime, RuntimeResult
from studio.runtime.claude_code import ClaudeCodeRuntime
from studio.runtime.codex import CodexRuntime
from studio.runtime.fake import FakeRuntime

__all__ = [
    "ClaudeCodeRuntime",
    "CodexRuntime",
    "FakeRuntime",
    "ModelRuntime",
    "RuntimeResult",
    "make_runtime",
]

_KINDS = {"claude": ClaudeCodeRuntime, "codex": CodexRuntime}


def make_runtime(cfg: RuntimeConfig, executor: CommandExecutor | None = None) -> ModelRuntime:
    return _KINDS[cfg.kind or cfg.name](cfg, executor)
