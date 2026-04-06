"""Centralized intent resolver.

Determines the intent for any message by running a chain of checks
from cheapest to most expensive, stopping as soon as one matches:

1. Explicit override (e.g. remember@ shortcut)     → free
2. Heuristics (bare URL, keyword prefix, etc.)      → free
3. LLM classification via Claude                    → costs tokens

To add a new heuristic, add a function to _HEURISTICS. Each function
takes the message text and returns an intent string or None.
"""

import json
import logging
import os
import re

from anthropic import AsyncAnthropic

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Heuristics — free checks, no LLM
# ---------------------------------------------------------------------------

def _is_bare_url(text: str) -> str | None:
    """If the message is just a URL with no other text, it's a remember.

    People don't send bare links to chat about — they want to save them.
    """
    stripped = text.strip()
    if re.match(r'^https?://\S+$', stripped):
        logger.info("Heuristic match: bare URL")
        return "remember"
    return None


def _starts_with_remember_keyword(text: str) -> str | None:
    """If the message starts with an explicit save instruction, it's a remember.

    Catches: "remember this", "save this link", "keep this", etc.
    """
    KEYWORDS = [
        "remember this",
        "remember:",
        "save this",
        "save:",
        "keep this",
        "keep:",
        "store this",
        "store:",
    ]
    lower = text.strip().lower()
    for kw in KEYWORDS:
        if lower.startswith(kw):
            logger.info("Heuristic match: keyword prefix '%s'", kw)
            return "remember"
    return None


def _starts_with_recall_keyword(text: str) -> str | None:
    """If the message starts with a recall instruction, it's a recall.

    Catches: "remind me", "find", "show me", "what was", "search for", etc.
    """
    KEYWORDS = [
        "remind me",
        "find ",
        "find:",
        "show me",
        "what was",
        "where was",
        "where is",
        "what's that",
        "search for",
        "look for",
        "pull up",
        "do i have",
        "did i save",
    ]
    lower = text.strip().lower()
    for kw in KEYWORDS:
        if lower.startswith(kw):
            logger.info("Heuristic match: recall keyword prefix '%s'", kw)
            return "recall"
    return None


# Ordered list of heuristic functions. Each takes text, returns intent or None.
# Add new heuristics here — they run in order, first match wins.
_HEURISTICS = [
    _is_bare_url,
    _starts_with_remember_keyword,
    _starts_with_recall_keyword,
]


# ---------------------------------------------------------------------------
# LLM classification — expensive, last resort
# ---------------------------------------------------------------------------

INTENT_SYSTEM_PROMPT = """You are an intent classifier for a personal assistant called Hank.

Given a user message, classify the intent as one of:
- "remember" — the user wants to save/remember something for later (e.g. "remember this", "save this", "keep this", forwarded content they want stored)
- "recall" — the user wants to find/retrieve something they previously saved (e.g. "remind me about", "find that receipt", "show me the link", "what was that URL")
- "chat" — normal conversation, questions, or anything else

Respond with ONLY a JSON object, no other text:
{"intent": "remember" or "recall" or "chat"}

Note: the message may be truncated. Focus on the first few lines to determine intent."""

# Lazy-initialized Claude client (only created if LLM classification is needed)
_client: AsyncAnthropic | None = None


def _get_client() -> AsyncAnthropic:
    """Get or create the Anthropic client."""
    global _client
    if _client is None:
        _client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


async def _classify_with_llm(text: str) -> str:
    """Ask Claude to classify the intent. Only sends the first ~500 chars.

    This is the expensive fallback — only called when heuristics can't
    determine the intent.
    """
    # Truncate for classification — the intent is in the first few lines
    snippet = text[:500]
    if len(text) > 500:
        snippet += "\n\n[... message truncated for classification]"

    logger.info("LLM intent classification (%d chars, snippet %d chars)", len(text), len(snippet))
    message = await _get_client().messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=128,
        system=INTENT_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": snippet}],
    )

    raw = message.content[0].text.strip()
    logger.info("LLM intent response: %s", raw)

    try:
        result = json.loads(raw)
        return result.get("intent", "chat")
    except json.JSONDecodeError:
        logger.warning("Failed to parse intent JSON, falling back to chat: %s", raw)
        return "chat"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def resolve_intent(text: str, explicit_intent: str | None = None) -> str:
    """Determine the intent for a message.

    Runs cheap heuristics first, falls back to LLM only when needed.

    Args:
        text: The message text.
        explicit_intent: Pre-determined intent (e.g. from remember@ shortcut).
                         If set, skips all detection.

    Returns:
        "remember" or "chat"
    """
    # 1. Explicit override — e.g. remember@ shortcut
    if explicit_intent:
        logger.info("Intent: %s (explicit)", explicit_intent)
        return explicit_intent

    # 2. Heuristics — free, no LLM
    for heuristic in _HEURISTICS:
        result = heuristic(text)
        if result:
            logger.info("Intent: %s (heuristic)", result)
            return result

    # 3. LLM classification — expensive, last resort
    intent = await _classify_with_llm(text)
    logger.info("Intent: %s (LLM)", intent)
    return intent
