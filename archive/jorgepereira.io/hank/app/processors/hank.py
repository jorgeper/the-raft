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

For "remember": extract the actual content to save. Strip out the instruction part (e.g. remove "remember this:" or "save this for me") and keep the valuable content.
For "chat": set save_content to null."""


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

        Returns a dict with:
        - "intent": "chat" or "remember"
        - "save_content": content to save (if remember), or None
        """
        logger.info("Detecting intent for message (%d chars)", len(text))
        message = await self._client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=256,
            system=INTENT_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": text}],
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
        save_content = text  # default: save the full text (for remember@ shortcut)

        if intent is None:
            # No pre-determined intent — ask Claude to classify
            detected = await self._detect_intent(text)
            intent = detected["intent"]
            if detected["save_content"]:
                save_content = detected["save_content"]

        logger.info("Intent: %s", intent)

        if intent == "remember":
            # Format the content as markdown and save to disk
            now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
            title = save_content.split("\n")[0].strip()[:80] or "Memory"
            # If it's already formatted markdown (from email handler), save as-is.
            # Otherwise, wrap it in a simple markdown format.
            if not save_content.startswith("# "):
                save_content = f"# {title}\n\n**Date:** {now}\n\n---\n\n{save_content}\n"
            return await save_memory(save_content)

        # Default: chat
        return await self._chat.run(chat_id, text)
