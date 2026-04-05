"""Remember action — saves content as markdown files on disk.

Storage layout:
    data/memories/
    ├── 2026-04-05/
    │   ├── 2026-04-05T21-33-02_wifi-password.md
    │   └── 2026-04-05T21-45-10_youtube-link.md
    └── 2026-04-06/
        └── 2026-04-06T09-15-22_recipe.md

Called by HankProcessor when it detects a "remember" intent,
or directly by the email handler for remember@ shortcut emails.
"""

import logging
import os
import re
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Where memories are stored. Mounted as a Docker volume so data
# survives container rebuilds.
MEMORIES_DIR = os.getenv("MEMORIES_DIR", "data/memories")


def _slugify(text: str, max_length: int = 50) -> str:
    """Turn a string into a filename-safe slug.

    "WiFi password at the cabin" → "wifi-password-at-the-cabin"
    """
    slug = text.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)  # remove non-word chars
    slug = re.sub(r"[\s_]+", "-", slug)   # spaces/underscores → hyphens
    slug = re.sub(r"-+", "-", slug)       # collapse multiple hyphens
    slug = slug.strip("-")
    return slug[:max_length] or "memory"


async def save_memory(content: str) -> str:
    """Save content as a markdown file and return a confirmation.

    Args:
        content: The full markdown content to save (already formatted
                 with title, metadata, and body).

    Returns:
        A confirmation message.
    """
    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%Y-%m-%dT%H-%M-%S")

    # Use the first line as the title for the slug
    first_line = content.split("\n")[0].strip().lstrip("# ")
    slug = _slugify(first_line)

    # Create the day folder
    day_dir = os.path.join(MEMORIES_DIR, date_str)
    os.makedirs(day_dir, exist_ok=True)

    # Write the markdown file
    filename = f"{time_str}_{slug}.md"
    filepath = os.path.join(day_dir, filename)

    with open(filepath, "w") as f:
        f.write(content)

    logger.info("Saved memory to %s", filepath)
    return "Got it, I'll remember that."
