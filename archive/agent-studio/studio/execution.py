"""The single subprocess seam. Every external process (gh, git, claude, codex)
goes through a CommandExecutor so tests can fake the world.
"""

from __future__ import annotations

import os
import signal
import subprocess
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class CommandResult:
    argv: tuple[str, ...]
    returncode: int
    stdout: str = ""
    stderr: str = ""
    duration_s: float = 0.0

    @property
    def ok(self) -> bool:
        return self.returncode == 0


class CommandExecutor:
    """Runs real subprocesses."""

    def run(
        self,
        argv: list[str],
        *,
        cwd: Path | None = None,
        timeout_s: int = 600,
        input_text: str | None = None,
    ) -> CommandResult:
        start = time.monotonic()
        try:
            proc = subprocess.run(
                argv,
                cwd=cwd,
                input=input_text,
                capture_output=True,
                text=True,
                timeout=timeout_s,
            )
            code, out, err = proc.returncode, proc.stdout, proc.stderr
        except subprocess.TimeoutExpired as exc:
            code = 124
            out = (exc.stdout or b"").decode() if isinstance(exc.stdout, bytes) else (exc.stdout or "")
            err = f"timed out after {timeout_s}s"
        except FileNotFoundError:
            code, out, err = 127, "", f"command not found: {argv[0]}"
        return CommandResult(
            argv=tuple(argv),
            returncode=code,
            stdout=out,
            stderr=err,
            duration_s=time.monotonic() - start,
        )

    def stream(
        self,
        argv: list[str],
        *,
        on_line,
        cwd: Path | None = None,
        timeout_s: int = 3600,
    ) -> CommandResult:
        """Run a process, delivering stdout line by line to `on_line` as it
        arrives. A deadline timer kills the process if it overruns."""
        start = time.monotonic()
        collected: list[str] = []
        try:
            proc = subprocess.Popen(
                argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                start_new_session=True,  # so the deadline kill reaps grandchildren too
            )
        except FileNotFoundError:
            return CommandResult(argv=tuple(argv), returncode=127,
                                 stderr=f"command not found: {argv[0]}")

        def _kill_group() -> None:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                proc.kill()

        timer = threading.Timer(timeout_s, _kill_group)
        timer.start()
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                collected.append(line)
                try:
                    on_line(line.rstrip("\n"))
                except Exception:  # noqa: BLE001 — a consumer bug must not kill the work
                    pass
            stderr = proc.stderr.read() if proc.stderr else ""
            code = proc.wait()
        finally:
            timer.cancel()
        return CommandResult(
            argv=tuple(argv), returncode=code, stdout="".join(collected),
            stderr=stderr, duration_s=time.monotonic() - start,
        )


@dataclass
class FakeExecutor:
    """Scripted executor for tests: queue results, record every call."""

    results: list[CommandResult] = field(default_factory=list)
    default: CommandResult = CommandResult(argv=(), returncode=0)
    calls: list[tuple[str, ...]] = field(default_factory=list)

    def queue(self, stdout: str = "", returncode: int = 0, stderr: str = "") -> None:
        self.results.append(
            CommandResult(argv=(), returncode=returncode, stdout=stdout, stderr=stderr)
        )

    def run(self, argv, *, cwd=None, timeout_s=600, input_text=None) -> CommandResult:
        self.calls.append(tuple(argv))
        result = self.results.pop(0) if self.results else self.default
        return CommandResult(
            argv=tuple(argv),
            returncode=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr,
        )

    def stream(self, argv, *, on_line, cwd=None, timeout_s=3600) -> CommandResult:
        """Replays the queued result's stdout line by line."""
        result = self.run(argv, cwd=cwd, timeout_s=timeout_s)
        for line in result.stdout.splitlines():
            on_line(line)
        return result
