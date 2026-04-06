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

# Words/patterns that signal the user is giving up or changing topic,
# not continuing a disambiguation.
_EXIT_KEYWORDS = [
    "nevermind", "never mind", "forget it", "cancel", "stop",
    "nvm", "nah", "no thanks", "no thank you",
]


def _is_new_intent(text: str) -> bool:
    """Check if a message is clearly a new intent, not a disambiguation reply.

    Returns True if the user is:
    - Starting a new remember/recall with keywords
    - Sending a URL (remember)
    - Giving up (nevermind, cancel, etc.)
    - Sending a long message (disambiguation replies are short)
    """
    stripped = text.strip().lower()

    # Exit keywords — user is giving up
    if any(stripped.startswith(kw) for kw in _EXIT_KEYWORDS):
        return True

    # Bare URL — new remember intent
    import re
    if re.match(r'^https?://\S+$', stripped):
        return True

    # Starts with a remember/recall keyword — new intent
    from app.intent import _starts_with_remember_keyword, _starts_with_recall_keyword
    if _starts_with_remember_keyword(text) or _starts_with_recall_keyword(text):
        return True

    # Long message (>100 chars) is unlikely a disambiguation reply like "the first one"
    if len(stripped) > 100:
        return True

    return False


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

        # Check if this chat is in disambiguation mode (previous recall had multiple matches).
        # Continue recall UNLESS the user is clearly starting something new.
        if chat_id in self._pending_recall and intent is None:
            # Check if this looks like a new intent (not a disambiguation reply)
            if _is_new_intent(text):
                logger.info("Breaking out of recall disambiguation — new intent detected")
                self._pending_recall.discard(chat_id)
            else:
                logger.info("Continuing recall disambiguation for chat_id=%s", chat_id)
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

            # If still disambiguating, keep the flag so the next message continues recall.
            # If found or not_found, clear it — recall is done.
            if result.action == "disambiguate":
                self._pending_recall.add(chat_id)
                logger.info("Recall disambiguation pending for chat_id=%s (%d matches)", chat_id, len(result.matches))
            else:
                self._pending_recall.discard(chat_id)
                logger.info("Recall complete for chat_id=%s: %s", chat_id, result.action)

            return result

        # Default: chat
        self._pending_recall.discard(chat_id)
        image_path = metadata.image_path if metadata else None
        return await self._chat.run(chat_id, text, image_path=image_path)
