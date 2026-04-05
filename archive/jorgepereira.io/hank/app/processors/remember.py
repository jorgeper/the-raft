"""Remember processor — saves email content as markdown files on disk.

When someone emails remember@hank.jorgepereira.io, this processor saves
the email content as a markdown file organized by date. No AI involved —
just writes the file and confirms.

Storage layout:
    data/memories/
    ├── 2026-04-05/
    │   ├── 2026-04-05T21-33-02_wifi-password.md
    │   └── 2026-04-05T21-45-10_youtube-link.md
    └── 2026-04-06/
        └── 2026-04-06T09-15-22_recipe.md
"""

import logging
import os
import re
from datetime import datetime, timezone

from app.processor import Processor

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


class RememberProcessor(Processor):
    """Saves messages as markdown files on disk.

    Each message becomes a file in data/memories/YYYY-MM-DD/.
    The processor receives the email subject and body as a formatted string
    from the email handler, writes it to disk, and returns a confirmation.
    """

    async def process(self, chat_id: int, text: str) -> str:
        """Save the text as a markdown file and return a confirmation."""
        now = datetime.now(timezone.utc)
        date_str = now.strftime("%Y-%m-%d")
        time_str = now.strftime("%Y-%m-%dT%H-%M-%S")

        # Use the first line as the title for the slug, or fall back to "memory"
        first_line = text.split("\n")[0].strip()
        slug = _slugify(first_line)

        # Create the day folder
        day_dir = os.path.join(MEMORIES_DIR, date_str)
        os.makedirs(day_dir, exist_ok=True)

        # Write the markdown file
        filename = f"{time_str}_{slug}.md"
        filepath = os.path.join(day_dir, filename)

        with open(filepath, "w") as f:
            f.write(text)

        logger.info("Saved memory to %s", filepath)
        return "Got it, I'll remember that."
