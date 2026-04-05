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

# System prompt that defines Hank's personality.
# This is sent with every API call — Claude sees it as context for how to behave.
SYSTEM_PROMPT = """You are Hank, a friendly and laid-back chat buddy. You're warm, \
curious, and always up for a good conversation about anything. Keep your replies \
conversational and concise — you're chatting on Telegram, not writing essays."""

# How long to keep messages in conversation history.
# Messages older than this are dropped before each API call.
# This keeps context relevant and prevents the API call from getting too large.
MAX_AGE = 3600  # 1 hour


class ClaudeProcessor(Processor):
    """Processes messages via the Anthropic Claude API.

    Keeps an in-memory conversation history per chat_id, pruning messages
    older than MAX_AGE seconds before each API call. This means:
    - Each Telegram chat gets its own history
    - Each email sender gets their own history (via hashed email → chat_id)
    - History is lost on restart (in-memory only)
    """

    def __init__(self) -> None:
        self._client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        # History: chat_id → list of (timestamp, message_dict) tuples.
        # message_dict is {"role": "user"|"assistant", "content": "..."} — the format
        # the Anthropic API expects.
        self._history: dict[int, list[tuple[float, dict]]] = {}

    def _get_messages(self, chat_id: int) -> list[dict]:
        """Return conversation history for chat_id, dropping expired messages.

        This prunes old messages in-place and returns the remaining ones
        in the format the Anthropic API expects (list of role/content dicts).
        """
        cutoff = time.time() - MAX_AGE
        entries = self._history.get(chat_id, [])
        # Keep only messages newer than the cutoff
        self._history[chat_id] = [(ts, msg) for ts, msg in entries if ts > cutoff]
        # Return just the message dicts (without timestamps) for the API call
        return [msg for _, msg in self._history[chat_id]]

    def _append(self, chat_id: int, role: str, text: str) -> None:
        """Append a message to the conversation history.

        Called twice per exchange: once for the user's message, once for
        the assistant's reply. Both are timestamped so they can be pruned.
        """
        self._history.setdefault(chat_id, []).append(
            (time.time(), {"role": role, "content": text})
        )

    async def process(self, chat_id: int, text: str) -> str:
        """Send a message to Claude and return the reply.

        1. Append the user's message to history
        2. Get the full conversation history (pruned to last hour)
        3. Send everything to the Anthropic API with the Hank system prompt
        4. Append the assistant's reply to history
        5. Return the reply text
        """
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
