"""Recall action — find memories by sending the full index to Claude.

Sends the entire memory index + the user's query to Claude, which
semantically matches and returns the best result(s). No RAG, no
search algorithm — just context window.

The goal of recall is always to return a specific memory. Claude either:
- Finds one match → returns it
- Finds multiple → asks the user to pick
- Finds none → says so

Returns a RecallResult that the channel layer uses to send the appropriate
response (image, URL, text, disambiguation).
"""

import json
import logging
import os
import re
from dataclasses import dataclass

from anthropic import AsyncAnthropic

from app.memory_index import load_index
from app.actions.remember import MEMORIES_DIR

logger = logging.getLogger(__name__)

RECALL_SYSTEM_PROMPT = """You are Hank, helping the user find something from their saved memories.

Here are ALL of the user's saved memories:

{index}

The user is asking you to find a specific memory. Your job is to find the best match.

Rules:
- ALWAYS try to match a memory. The user is asking for something they saved.
- If one clear match: return it.
- If multiple possible matches: list them briefly and ask which one.
- If no matches at all: say you couldn't find it.

Respond with ONLY a JSON object:
{{
  "action": "found" | "disambiguate" | "not_found",
  "matches": ["filepath1", "filepath2"],
  "reply": "your conversational reply to the user"
}}

For "found": matches should have exactly one filepath. Reply should describe what you found.
For "disambiguate": matches should list the candidates. Reply should ask the user to pick.
For "not_found": matches should be empty. Reply should suggest trying different keywords."""


@dataclass
class RecallResult:
    """Result of a recall search."""
    action: str          # "found", "disambiguate", "not_found"
    matches: list[str]   # list of filepaths
    reply: str           # conversational reply text
    memory_file: str | None = None   # path to the matched .md file (if found)
    image_file: str | None = None    # path to image (if the memory is an image)


async def recall(chat_id: int, text: str, conversation_history: list[dict] | None = None) -> RecallResult:
    """Search memories by sending the full index to Claude.

    Args:
        chat_id: The conversation ID.
        text: The user's recall query.
        conversation_history: Previous messages for disambiguation context.

    Returns:
        RecallResult with the match(es) and a reply.
    """
    index = load_index()

    if not index:
        return RecallResult(
            action="not_found",
            matches=[],
            reply="You don't have any saved memories yet. Send me something to remember first!",
        )

    # Build the prompt with the full index
    index_text = json.dumps(index, indent=2)
    system = RECALL_SYSTEM_PROMPT.format(index=index_text)

    # Build messages — include conversation history for disambiguation
    messages = []
    if conversation_history:
        messages.extend(conversation_history)
    messages.append({"role": "user", "content": text})

    logger.info("Recall: sending %d index entries + query to Claude (%d chars index)",
                len(index), len(index_text))

    client = AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    message = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        system=system,
        messages=messages,
    )

    raw = message.content[0].text.strip()

    # Strip markdown code fences if Claude wrapped the JSON in ```json ... ```
    if raw.startswith("```"):
        raw = re.sub(r'^```(?:json)?\s*', '', raw)
        raw = re.sub(r'\s*```$', '', raw)
        raw = raw.strip()

    logger.info("Recall response: %s", raw[:300])

    # Parse the JSON response
    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Failed to parse recall JSON: %s", raw)
        return RecallResult(action="not_found", matches=[], reply=raw)

    action = result.get("action", "not_found")
    matches = result.get("matches", [])
    reply = result.get("reply", "I couldn't find that.")

    # If found, resolve the memory file and check for associated files
    memory_file = None
    image_file = None
    if action == "found" and matches:
        memory_file = matches[0]
        # Check if this memory has an image
        if os.path.exists(memory_file):
            from app.memory_index import _parse_frontmatter
            meta = _parse_frontmatter(memory_file)
            if meta.get("image"):
                date_dir = os.path.dirname(memory_file)
                img_path = os.path.join(date_dir, meta["image"])
                if os.path.exists(img_path):
                    image_file = img_path

    return RecallResult(
        action=action,
        matches=matches,
        reply=reply,
        memory_file=memory_file,
        image_file=image_file,
    )
