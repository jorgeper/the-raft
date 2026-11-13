"""ClaudeCodeRuntime: headless `claude -p`, optionally as a named subagent.

Streaming: with an `on_output` callback we switch to `--output-format stream-json
--verbose` (the CLI requires --verbose with -p + stream-json; verified against
claude 2.x, see tests/data/claude-stream-sample.jsonl captured from a real run)
and parse each JSONL line, forwarding assistant text and tool-use notices.
Unknown line types are skipped — the format grows over time.
"""

from __future__ import annotations

import json
import shutil

from studio.config import RuntimeConfig
from studio.execution import CommandExecutor
from studio.runtime.base import ModelRuntime, OnOutput, RuntimeResult


class ClaudeCodeRuntime(ModelRuntime):
    def __init__(self, cfg: RuntimeConfig, executor: CommandExecutor | None = None) -> None:
        self.name = cfg.name
        self.cmd = cfg.cmd
        self.extra_flags = list(cfg.extra_flags)
        self.executor = executor or CommandExecutor()

    def build_argv(
        self, prompt: str, agent: str | None = None, streaming: bool = False
    ) -> list[str]:
        if streaming:
            argv = [self.cmd, "-p", prompt, "--output-format", "stream-json", "--verbose"]
        else:
            argv = [self.cmd, "-p", prompt, "--output-format", "text"]
        if agent:
            argv += ["--agent", agent]
        return argv + self.extra_flags

    def run(self, prompt, *, cwd, timeout_s=3600, agent=None, on_output=None) -> RuntimeResult:
        if on_output is not None:
            return self._run_streaming(prompt, cwd=cwd, timeout_s=timeout_s,
                                       agent=agent, on_output=on_output)
        result = self.executor.run(
            self.build_argv(prompt, agent), cwd=cwd, timeout_s=timeout_s
        )
        output = result.stdout if result.ok else f"{result.stdout}\n{result.stderr}".strip()
        return RuntimeResult(
            output=output, exit_code=result.returncode, duration_s=result.duration_s
        )

    def _run_streaming(
        self, prompt, *, cwd, timeout_s, agent, on_output: OnOutput
    ) -> RuntimeResult:
        final: dict = {"text": None}
        pieces: list[str] = []

        def on_line(line: str) -> None:
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                return
            if not isinstance(data, dict):
                return
            if data.get("type") == "assistant":
                for block in data.get("message", {}).get("content", []) or []:
                    if block.get("type") == "text" and block.get("text"):
                        pieces.append(block["text"])
                        on_output(block["text"], "text")
                    elif block.get("type") == "tool_use":
                        name = block.get("name", "?")
                        hint = ""
                        tool_input = block.get("input") or {}
                        for key in ("command", "description", "file_path", "pattern"):
                            if tool_input.get(key):
                                hint = str(tool_input[key])[:80]
                                break
                        on_output(f"tool: {name}" + (f" `{hint}`" if hint else ""), "tool")
            elif data.get("type") == "result":
                if isinstance(data.get("result"), str):
                    final["text"] = data["result"]
            # every other line type (system, rate_limit_event, future kinds): skipped

        result = self.executor.stream(
            self.build_argv(prompt, agent, streaming=True),
            cwd=cwd, timeout_s=timeout_s, on_line=on_line,
        )
        output = final["text"] if final["text"] is not None else "".join(pieces)
        if not result.ok and not output:
            output = result.stderr.strip()
        return RuntimeResult(
            output=output, exit_code=result.returncode, duration_s=result.duration_s
        )

    def available(self) -> bool:
        return shutil.which(self.cmd) is not None
