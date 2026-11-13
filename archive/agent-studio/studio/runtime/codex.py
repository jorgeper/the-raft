"""CodexRuntime: headless `codex exec`. Skills are inlined into the prompt by the
agent registry — this runtime has no native subagent concept."""

from __future__ import annotations

import shutil

from studio.config import RuntimeConfig
from studio.execution import CommandExecutor
from studio.runtime.base import ModelRuntime, RuntimeResult


class CodexRuntime(ModelRuntime):
    def __init__(self, cfg: RuntimeConfig, executor: CommandExecutor | None = None) -> None:
        self.name = cfg.name
        self.cmd = cfg.cmd
        self.extra_flags = list(cfg.extra_flags)
        self.executor = executor or CommandExecutor()

    def build_argv(self, prompt: str) -> list[str]:
        return [self.cmd, "exec", prompt, *self.extra_flags]

    def run(self, prompt, *, cwd, timeout_s=3600, agent=None, on_output=None) -> RuntimeResult:
        if on_output is not None:
            # Generic fallback: raw stdout lines as text chunks.
            result = self.executor.stream(
                self.build_argv(prompt), cwd=cwd, timeout_s=timeout_s,
                on_line=lambda line: on_output(line + "\n", "text"),
            )
        else:
            result = self.executor.run(self.build_argv(prompt), cwd=cwd, timeout_s=timeout_s)
        output = result.stdout if result.ok else f"{result.stdout}\n{result.stderr}".strip()
        return RuntimeResult(
            output=output, exit_code=result.returncode, duration_s=result.duration_s
        )

    def available(self) -> bool:
        return shutil.which(self.cmd) is not None
