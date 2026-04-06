"""Chat action — conversational replies via Claude API.

Maintains per-chat conversation history with a 1-hour rolling window.
Extracted from the old ClaudeProcessor so it can be called by HankProcessor.
"""

import base64
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

    async def run(self, chat_id: int, text: str, image_path: str | None = None) -> str:
        """Send a message to Claude and return the reply.

        Args:
            chat_id: Conversation ID.
            text: The user's message text.
            image_path: Optional path to an image file to include via vision API.
        """
        # Build the user message content
        if image_path and os.path.exists(image_path):
            # Multi-modal: text + image
            with open(image_path, "rb") as f:
                image_bytes = f.read()
            image_data = base64.b64encode(image_bytes).decode("ascii")

            # Detect media type from magic bytes
            if image_bytes[:3] == b'\xff\xd8\xff':
                media_type = "image/jpeg"
            elif image_bytes[:8] == b'\x89PNG\r\n\x1a\n':
                media_type = "image/png"
            elif image_bytes[:4] == b'GIF8':
                media_type = "image/gif"
            elif image_bytes[:4] == b'RIFF' and image_bytes[8:12] == b'WEBP':
                media_type = "image/webp"
            else:
                media_type = "image/png"

            content = [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_data}},
                {"type": "text", "text": text},
            ]
            # Store text-only version in history (images are too large to keep)
            self._append(chat_id, "user", f"{text}\n[image attached]")
        else:
            content = text
            self._append(chat_id, "user", text)

        # Build messages: history + current (replace last entry with full content)
        messages = self._get_messages(chat_id)
        if messages:
            messages[-1] = {"role": "user", "content": content}

        logger.info("Sending to Claude API (%d chars, %d messages in history, image=%s)",
                     len(text), len(messages), image_path is not None)
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
