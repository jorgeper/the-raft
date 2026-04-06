"""Hank processor — unified smart processor with intent routing.

The main processor for all channels (Telegram and email). Receives a message,
resolves the intent via app/intent.py (heuristics first, LLM fallback),
and routes to the appropriate action.

Intents:
- "chat"     — normal conversation, routed to ChatAction
- "remember" — save content to disk, routed to save_memory()
- "recall"   — find a memory, routed to recall()

The process() method returns either a plain string or a RecallResult
(for recall intent, so the channel layer can send images/files).
"""

import logging

from app.actions.chat import ChatAction
from app.actions.recall import recall, RecallResult
from app.actions.remember import MemoryMetadata, save_memory
from app.intent import resolve_intent
from app.processor import Processor

logger = logging.getLogger(__name__)


class HankProcessor(Processor):
    """Unified processor that resolves intent and routes to the right action."""

    def __init__(self) -> None:
        self._chat = ChatAction()

    async def process(
        self,
        chat_id: int,
        text: str,
        intent: str | None = None,
        metadata: MemoryMetadata | None = None,
    ) -> str | RecallResult:
        """Process a message by resolving intent and routing to the right action.

        Returns:
            str for chat/remember, RecallResult for recall.
            The channel layer (bot.py, email_handler.py) handles RecallResult
            to send images, URLs, etc.
        """
        intent = await resolve_intent(text, explicit_intent=intent)

        if intent == "remember":
            return await save_memory(text, metadata=metadata)

        if intent == "recall":
            # Get conversation history for disambiguation context
            history = self._chat._get_messages(chat_id)
            result = await recall(chat_id, text, conversation_history=history or None)
            # Store the recall exchange in chat history for follow-up disambiguation
            self._chat._append(chat_id, "user", text)
            self._chat._append(chat_id, "assistant", result.reply)
            return result

        # Default: chat
        return await self._chat.run(chat_id, text)
