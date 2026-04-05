"""Base processor interface.

All message processors must subclass Processor and implement the
async process() method. The bot receives a Processor instance at
startup and delegates every incoming message to it.
"""

from abc import ABC, abstractmethod


class Processor(ABC):
    """Abstract base class for message processors.

    Subclasses receive the Telegram chat_id and message text,
    and return the reply string.
    """

    @abstractmethod
    async def process(self, chat_id: int, text: str) -> str: ...
