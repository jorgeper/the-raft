"""Hello-world processor for testing.

Echoes the user's message back. Useful for verifying the bot is running
without needing any API keys.

Set PROCESSOR=helloworld in .env to use this.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.processor import Processor

if TYPE_CHECKING:
    from app.actions.remember import MemoryMetadata


class HelloWorldProcessor(Processor):
    """Echoes back the user's message. No external dependencies."""

    async def process(
        self,
        chat_id: int,
        text: str,
        intent: str | None = None,
        metadata: "MemoryMetadata | None" = None,
    ) -> str:
        return f"Hello! You said: {text}"
