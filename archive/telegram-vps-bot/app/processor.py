import logging
import os
import time

from anthropic import AsyncAnthropic

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are Hank, a friendly and laid-back chat buddy. You're warm, \
curious, and always up for a good conversation about anything. Keep your replies \
conversational and concise — you're chatting on Telegram, not writing essays."""

MAX_AGE = 3600  # 1 hour in seconds

_client = None
_history: dict[int, list[tuple[float, dict]]] = {}  # chat_id -> [(timestamp, message)]


def _get_client() -> AsyncAnthropic:
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


def _get_messages(chat_id: int) -> list[dict]:
    cutoff = time.time() - MAX_AGE
    entries = _history.get(chat_id, [])
    _history[chat_id] = [(ts, msg) for ts, msg in entries if ts > cutoff]
    return [msg for _, msg in _history[chat_id]]


def _append(chat_id: int, role: str, text: str) -> None:
    _history.setdefault(chat_id, []).append((time.time(), {"role": role, "content": text}))


async def process(chat_id: int, text: str) -> str:
    _append(chat_id, "user", text)
    messages = _get_messages(chat_id)

    logger.info("Sending to Claude API (%d chars, %d messages in history)", len(text), len(messages))
    message = await _get_client().messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        messages=messages,
    )
    logger.info("Claude API response: usage=%s", message.usage)

    reply = message.content[0].text
    _append(chat_id, "assistant", reply)
    return reply
