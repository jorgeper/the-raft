"""Hank processor — unified smart processor with intent routing.

The main processor for all channels (Telegram and email). Receives a message,
resolves the intent via app/intent.py (heuristics first, LLM fallback),
and routes to the appropriate action.

Intents:
- "chat"     — normal conversation, routed to ChatAction (Claude API)
- "remember" — save content to disk, routed to save_memory()
"""

import logging
from datetime import datetime, timezone

from app.actions.chat import ChatAction
from app.actions.remember import save_memory
from app.intent import resolve_intent
from app.processor import Processor

logger = logging.getLogger(__name__)


class HankProcessor(Processor):
    """Unified processor that resolves intent and routes to the right action.

    Intent resolution is handled by app/intent.py which runs:
    1. Explicit override (remember@ shortcut) — free
    2. Heuristics (bare URL, keyword prefix) — free
    3. LLM classification — only if heuristics can't decide
    """

    def __init__(self) -> None:
        self._chat = ChatAction()

    async def process(self, chat_id: int, text: str, intent: str | None = None) -> str:
        """Process a message by resolving intent and routing to the right action.

        Args:
            chat_id: Unique ID for the conversation (Telegram chat or hashed email).
            text: The message text.
            intent: Pre-determined intent (skips detection). Used by remember@ shortcut.
        """
        # Resolve intent — cheap heuristics first, LLM only if needed
        intent = await resolve_intent(text, explicit_intent=intent)

        if intent == "remember":
            # Save the full original text to disk.
            # If it's already formatted markdown (from email handler remember@ shortcut),
            # save as-is. Otherwise, wrap it in a simple markdown format.
            if not text.startswith("# "):
                now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
                title = text.split("\n")[0].strip()[:80] or "Memory"
                text = f"# {title}\n\n**Date:** {now}\n\n---\n\n{text}\n"
            return await save_memory(text)

        # Default: chat
        return await self._chat.run(chat_id, text)
