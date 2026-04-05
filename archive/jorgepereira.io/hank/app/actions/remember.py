"""Remember action — saves content as markdown files with YAML frontmatter.

Storage layout:
    data/memories/
    ├── 2026-04-05/
    │   ├── 2026-04-05T21-33-02_wifi-password.md
    │   └── 2026-04-05T21-45-10_youtube-link.md
    └── 2026-04-06/
        └── 2026-04-06T09-15-22_recipe.md

Each file has YAML frontmatter (Obsidian-style) with metadata:
    ---
    date: 2026-04-05
    time: "21:33:02"
    medium: telegram
    type: url
    source: Jorge (id=123)
    tags: []
    ---
"""

import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# Where memories are stored. Mounted as a Docker volume.
MEMORIES_DIR = os.getenv("MEMORIES_DIR", "data/memories")


@dataclass
class MemoryMetadata:
    """Metadata attached to every saved memory.

    Created by the channel layer (bot.py, email_handler.py) and passed
    through HankProcessor to save_memory().
    """
    medium: str = "unknown"         # "telegram", "email", "email-remember"
    source: str = "unknown"         # email address or "Name (id=123)"
    content_type: str | None = None # "url", "note" — auto-detected if None
    tags: list[str] = field(default_factory=list)


def detect_content_type(text: str) -> str:
    """Auto-detect the content type from the text.

    - "url" if the text is primarily a URL
    - "note" for everything else
    """
    stripped = text.strip()
    # Bare URL
    if re.match(r'^https?://\S+$', stripped):
        return "url"
    # First line is a URL (common for forwarded links with commentary below)
    first_line = stripped.split("\n")[0].strip()
    if re.match(r'^https?://\S+$', first_line):
        return "url"
    return "note"


def _slugify(text: str, max_length: int = 50) -> str:
    """Turn a string into a filename-safe slug."""
    slug = text.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    slug = slug.strip("-")
    return slug[:max_length] or "memory"


def _build_frontmatter(metadata: MemoryMetadata, now: datetime) -> str:
    """Build YAML frontmatter string from metadata."""
    content_type = metadata.content_type or "note"
    tags_str = ", ".join(f'"{t}"' for t in metadata.tags) if metadata.tags else ""

    lines = [
        "---",
        f"date: {now.strftime('%Y-%m-%d')}",
        f'time: "{now.strftime("%H:%M:%S")}"',
        f"medium: {metadata.medium}",
        f"type: {content_type}",
        f"source: {metadata.source}",
        f"tags: [{tags_str}]",
        "---",
    ]
    return "\n".join(lines)


async def save_memory(content: str, metadata: MemoryMetadata | None = None) -> str:
    """Save content as a markdown file with frontmatter and run post-processors.

    Args:
        content: The body content to save.
        metadata: Metadata from the channel layer. If None, uses defaults.

    Returns:
        A confirmation message.
    """
    if metadata is None:
        metadata = MemoryMetadata()

    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")
    time_str = now.strftime("%Y-%m-%dT%H-%M-%S")

    # Auto-detect content type if not set
    if metadata.content_type is None:
        metadata.content_type = detect_content_type(content)

    # Build the title from the first line of content
    first_line = content.split("\n")[0].strip().lstrip("# ")
    title = first_line[:80] or "Memory"
    slug = _slugify(first_line)

    # Build the full markdown file: frontmatter + title + body
    frontmatter = _build_frontmatter(metadata, now)
    # If content already has a # title, use it. Otherwise, add one.
    if content.strip().startswith("# "):
        full_content = f"{frontmatter}\n\n{content}"
    else:
        full_content = f"{frontmatter}\n\n# {title}\n\n{content}\n"

    # Create the day folder and write the file
    day_dir = os.path.join(MEMORIES_DIR, date_str)
    os.makedirs(day_dir, exist_ok=True)

    filename = f"{time_str}_{slug}.md"
    filepath = os.path.join(day_dir, filename)

    with open(filepath, "w") as f:
        f.write(full_content)

    logger.info("Saved memory to %s (type=%s, medium=%s)", filepath, metadata.content_type, metadata.medium)

    # Run post-processors for this content type
    from app.actions.post_processors import run_post_processors
    await run_post_processors(filepath, metadata)

    return "Got it, I'll remember that."
