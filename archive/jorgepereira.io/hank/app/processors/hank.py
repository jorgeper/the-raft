"""Hank processor — unified smart processor with intent routing.

The main processor for all channels (Telegram and email). Receives a message,
resolves the intent via app/intent.py (heuristics first, LLM fallback),
and routes to the appropriate action.

Intents:
- "chat"     — normal conversation, routed to ChatAction
- "remember" — save content to disk, routed to save_memory()
- "recall"   — find a memory, routed to recall()

When a recall returns "disambiguate" (multiple matches), the next message
from this user is automatically routed back to recall — no fresh intent
detection. This lets "the first one" resolve correctly.
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
        # Track chats that are in disambiguation mode.
        # If a recall returns "disambiguate", the next message from this
        # chat_id goes straight back to recall instead of fresh intent detection.
        self._pending_recall: set[int] = set()

    async def process(
        self,
        chat_id: int,
        text: str,
        intent: str | None = None,
        metadata: MemoryMetadata | None = None,
    ) -> str | RecallResult:
        """Process a message by resolving intent and routing to the right action."""

        # Check if this chat is in disambiguation mode (previous recall had multiple matches)
        if chat_id in self._pending_recall and intent is None:
            logger.info("Continuing recall disambiguation for chat_id=%s", chat_id)
            self._pending_recall.discard(chat_id)
            intent = "recall"

        if intent is None:
            intent = await resolve_intent(text, explicit_intent=None)

        if intent == "remember":
            self._pending_recall.discard(chat_id)
            return await save_memory(text, metadata=metadata)

        if intent == "recall":
            # Get conversation history for disambiguation context
            history = self._chat._get_messages(chat_id)
            result = await recall(chat_id, text, conversation_history=history or None)

            # Store the recall exchange in chat history for follow-up context
            self._chat._append(chat_id, "user", text)
            self._chat._append(chat_id, "assistant", result.reply)

            # If disambiguating, flag this chat so the next message continues recall
            if result.action == "disambiguate":
                self._pending_recall.add(chat_id)
                logger.info("Recall disambiguation pending for chat_id=%s", chat_id)
            else:
                self._pending_recall.discard(chat_id)

            return result

        # Default: chat
        self._pending_recall.discard(chat_id)
        return await self._chat.run(chat_id, text)
