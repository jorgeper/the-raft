"""ClaudeCodeRuntime: headless `claude -p`, optionally as a named subagent."""

from __future__ import annotations

import shutil

from studio.config import RuntimeConfig
from studio.execution import CommandExecutor
from studio.runtime.base import ModelRuntime, RuntimeResult


class ClaudeCodeRuntime(ModelRuntime):
    def __init__(self, cfg: RuntimeConfig, executor: CommandExecutor | None = None) -> None:
        self.name = cfg.name
        self.cmd = cfg.cmd
        self.extra_flags = list(cfg.extra_flags)
        self.executor = executor or CommandExecutor()

    def build_argv(self, prompt: str, agent: str | None = None) -> list[str]:
        argv = [self.cmd, "-p", prompt, "--output-format", "text"]
        if agent:
            argv += ["--agent", agent]
        return argv + self.extra_flags

    def run(self, prompt, *, cwd, timeout_s=3600, agent=None) -> RuntimeResult:
        result = self.executor.run(
            self.build_argv(prompt, agent), cwd=cwd, timeout_s=timeout_s
        )
        output = result.stdout if result.ok else f"{result.stdout}\n{result.stderr}".strip()
        return RuntimeResult(
            output=output, exit_code=result.returncode, duration_s=result.duration_s
        )

    def available(self) -> bool:
        return shutil.which(self.cmd) is not None
