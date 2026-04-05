"""Hank processor — unified smart processor with intent detection.

The main processor for all channels (Telegram and email). Receives a message,
detects the intent (chat or remember), and routes to the appropriate action.

For messages with a pre-determined intent (e.g. remember@ shortcut emails),
the intent parameter is passed directly and detection is skipped.

Intents:
- "chat"     — normal conversation, routed to ChatAction (Claude API)
- "remember" — save content to disk, routed to save_memory()
"""

import json
import logging
import os
from datetime import datetime, timezone

from anthropic import AsyncAnthropic

from app.actions.chat import ChatAction
from app.actions.remember import save_memory
from app.processor import Processor

logger = logging.getLogger(__name__)

# System prompt for intent detection. Asks Claude to classify the message
# and return structured JSON so we can route to the right action.
INTENT_SYSTEM_PROMPT = """You are an intent classifier for a personal assistant called Hank.

Given a user message, classify the intent as one of:
- "remember" — the user wants to save/remember something for later (e.g. "remember this", "save this", "keep this", forwarded content they want stored)
- "chat" — normal conversation, questions, or anything else

Respond with ONLY a JSON object, no other text:
{"intent": "remember" or "chat", "save_content": "the content to save (only if remember, otherwise null)"}

For "remember": set save_content to "full" (the system will save the complete original message).
For "chat": set save_content to null.

Note: the message may be truncated. Focus on the first few lines to determine intent."""


class HankProcessor(Processor):
    """Unified processor that detects intent and routes to the right action.

    Args passed to process():
        chat_id: Telegram chat ID or hashed email address.
        text: The message text.
        intent: Optional pre-determined intent. If set, skips detection.
                Used by remember@ shortcut emails.
    """

    def __init__(self) -> None:
        self._client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        self._chat = ChatAction()

    async def _detect_intent(self, text: str) -> dict:
        """Ask Claude to classify the message intent.

        Only sends the first ~500 chars to Claude for classification.
        The intent is always at the top of the message ("remember this",
        "save this for me"), so we don't need to send the entire body.
        This saves tokens on long forwarded emails.

        Returns a dict with:
        - "intent": "chat" or "remember"
        - "save_content": content to save (if remember), or None
        """
        # Truncate for intent detection — the intent is in the first few lines
        snippet = text[:500]
        if len(text) > 500:
            snippet += "\n\n[... message truncated for classification]"

        logger.info("Detecting intent for message (%d chars, snippet %d chars)", len(text), len(snippet))
        message = await self._client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=256,
            system=INTENT_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": snippet}],
        )

        raw = message.content[0].text.strip()
        logger.info("Intent detection response: %s", raw)

        try:
            result = json.loads(raw)
            return {
                "intent": result.get("intent", "chat"),
                "save_content": result.get("save_content"),
            }
        except json.JSONDecodeError:
            # If Claude doesn't return valid JSON, fall back to chat
            logger.warning("Failed to parse intent JSON, falling back to chat: %s", raw)
            return {"intent": "chat", "save_content": None}

    async def process(self, chat_id: int, text: str, intent: str | None = None) -> str:
        """Process a message by detecting intent and routing to the right action.

        Args:
            chat_id: Unique ID for the conversation (Telegram chat or hashed email).
            text: The message text.
            intent: Pre-determined intent (skips detection). Used by remember@ shortcut.
        """
        if intent is None:
            # No pre-determined intent — ask Claude to classify
            detected = await self._detect_intent(text)
            intent = detected["intent"]

        logger.info("Intent: %s", intent)

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
