"""FakeRuntime: scripted responses for tests and the offline demo.

Responses can be plain strings or callables (prompt -> str), consumed in order.
A callable that raises StopIteration re-queues itself — handy for loops.
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from studio.runtime.base import ModelRuntime, RuntimeResult

Response = str | Callable[[str], str]


class FakeRuntime(ModelRuntime):
    def __init__(self, responses: list[Response] | None = None, name: str = "fake") -> None:
        self.name = name
        self.responses: list[Response] = list(responses or [])
        self.prompts: list[str] = []
        self.cwds: list[Path] = []
        self.agents: list[str | None] = []

    def script(self, *responses: Response) -> None:
        self.responses.extend(responses)

    def run(self, prompt, *, cwd, timeout_s=3600, agent=None) -> RuntimeResult:
        self.prompts.append(prompt)
        self.cwds.append(Path(cwd))
        self.agents.append(agent)
        if not self.responses:
            return RuntimeResult(output="", exit_code=0)
        response = self.responses.pop(0)
        output = response(prompt) if callable(response) else response
        return RuntimeResult(output=output, exit_code=0)

    def available(self) -> bool:
        return True
