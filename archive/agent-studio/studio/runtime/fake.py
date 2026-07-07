"""FakeRuntime: scripted responses for tests and the offline demo.

Responses can be plain strings, (final_text, [chunks]) tuples (chunks are streamed
to on_output before the final text is returned), or callables (prompt -> str).
"""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from studio.runtime.base import ModelRuntime, RuntimeResult

Response = str | tuple | Callable[[str], str]


class FakeRuntime(ModelRuntime):
    def __init__(self, responses: list[Response] | None = None, name: str = "fake") -> None:
        self.name = name
        self.responses: list[Response] = list(responses or [])
        self.prompts: list[str] = []
        self.cwds: list[Path] = []
        self.agents: list[str | None] = []

    def script(self, *responses: Response) -> None:
        self.responses.extend(responses)

    def run(self, prompt, *, cwd, timeout_s=3600, agent=None, on_output=None) -> RuntimeResult:
        self.prompts.append(prompt)
        self.cwds.append(Path(cwd))
        self.agents.append(agent)
        if not self.responses:
            return RuntimeResult(output="", exit_code=0)
        response = self.responses.pop(0)
        if isinstance(response, tuple):
            final, chunks = response
            if on_output is not None:
                for chunk in chunks:
                    on_output(chunk, "text")
            return RuntimeResult(output=final, exit_code=0)
        output = response(prompt) if callable(response) else response
        return RuntimeResult(output=output, exit_code=0)

    def available(self) -> bool:
        return True
