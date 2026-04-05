"""Claude-powered processor (Hank personality).

Sends messages to the Anthropic API and maintains per-chat conversation
history with a 1-hour rolling window. Requires ANTHROPIC_API_KEY in env.

Set PROCESSOR=claude in .env to use this (this is the default).
"""

import logging
import os
import time

from anthropic import AsyncAnthropic

from app.processor import Processor

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are Hank, a friendly and laid-back chat buddy. You're warm, \
curious, and always up for a good conversation about anything. Keep your replies \
conversational and concise — you're chatting on Telegram, not writing essays."""

MAX_AGE = 3600  # 1 hour — messages older than this are dropped from history


class ClaudeProcessor(Processor):
    """Processes messages via the Anthropic Claude API.

    Keeps an in-memory conversation history per chat_id, pruning messages
    older than MAX_AGE seconds before each API call.
    """

    def __init__(self) -> None:
        self._client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
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

    async def process(self, chat_id: int, text: str) -> str:
        self._append(chat_id, "user", text)
        messages = self._get_messages(chat_id)

        logger.info("Sending to Claude API (%d chars, %d messages in history)", len(text), len(messages))
        message = await self._client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            messages=messages,
        )
        logger.info("Claude API response: usage=%s", message.usage)

        reply = message.content[0].text
        self._append(chat_id, "assistant", reply)
        return reply
