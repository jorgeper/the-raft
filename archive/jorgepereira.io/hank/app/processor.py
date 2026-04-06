"""Base processor interface.

All message processors must subclass Processor and implement the
async process() method. The bot/email handler receives a Processor
instance at startup and delegates every incoming message to it.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.actions.remember import MemoryMetadata
    from app.identity import Identity


class Processor(ABC):
    """Abstract base class for message processors."""

    @abstractmethod
    async def process(
        self,
        chat_id: int,
        text: str,
        intent: str | None = None,
        metadata: "MemoryMetadata | None" = None,
        identity: "Identity | None" = None,
    ) -> str: ...
