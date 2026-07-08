"""Runtime factory."""

from __future__ import annotations

from blacksun.config import RuntimeConfig
from blacksun.execution import CommandExecutor
from blacksun.runtime.base import ModelRuntime, RuntimeResult
from blacksun.runtime.claude_code import ClaudeCodeRuntime
from blacksun.runtime.codex import CodexRuntime
from blacksun.runtime.fake import FakeRuntime

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
