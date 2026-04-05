"""Chat action — conversational replies via Claude API.

Maintains per-chat conversation history with a 1-hour rolling window.
Extracted from the old ClaudeProcessor so it can be called by HankProcessor.
"""

import logging
import os
import time

from anthropic import AsyncAnthropic

logger = logging.getLogger(__name__)

# System prompt that defines Hank's personality.
HANK_SYSTEM_PROMPT = """You are Hank, a friendly and laid-back chat buddy. You're warm, \
curious, and always up for a good conversation about anything. Keep your replies \
conversational and concise — you're chatting on Telegram, not writing essays."""

# Messages older than this are dropped from history before each API call.
MAX_AGE = 3600  # 1 hour


class ChatAction:
    """Handles conversational messages via the Claude API.

    Keeps an in-memory conversation history per chat_id, pruning messages
    older than MAX_AGE seconds before each API call.
    """

    def __init__(self) -> None:
        self._client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        # History: chat_id → list of (timestamp, message_dict) tuples.
        self._history: dict[int, list[tuple[float, dict]]] = {}

    def _get_messages(self, chat_id: int) -> list[dict]:
        """Return conversation history for chat_id, dropping expired messages."""
        cutoff = time.time() - MAX_AGE
        entries = self._history.get(chat_id, [])
        self._history[chat_id] = [(ts, msg) for ts, msg in entries if ts > cutoff]
        return [msg for _, msg in self._history[chat_id]]

    def _append(self, chat_id: int, role: str, text: str) -> None:
        """Append a message to the conversation history."""
        self._history.setdefault(chat_id, []).append(
            (time.time(), {"role": role, "content": text})
        )

    async def run(self, chat_id: int, text: str) -> str:
        """Send a message to Claude and return the reply."""
        self._append(chat_id, "user", text)
        messages = self._get_messages(chat_id)

        logger.info("Sending to Claude API (%d chars, %d messages in history)", len(text), len(messages))
        message = await self._client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=HANK_SYSTEM_PROMPT,
            messages=messages,
        )
        logger.info("Claude API response: usage=%s", message.usage)

        reply = message.content[0].text
        self._append(chat_id, "assistant", reply)
        return reply
