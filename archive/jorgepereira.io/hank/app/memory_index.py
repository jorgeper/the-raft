"""Memory index — build, read, and update a JSON index of all saved memories.

The index is a JSON file at data/memories/index.json containing a searchable
representation of every memory. Used by the recall action to send the full
index to Claude for semantic search.

Each entry contains metadata from frontmatter + body preview, enough for
Claude to identify and match memories without reading every file.
"""

import json
import logging
import os
import re
from dataclasses import dataclass, asdict

from app.actions.remember import MEMORIES_DIR

logger = logging.getLogger(__name__)

INDEX_PATH = os.path.join(MEMORIES_DIR, "index.json")


@dataclass
class IndexEntry:
    """A searchable representation of a single memory."""
    filepath: str
    date: str = ""
    time: str = ""
    medium: str = ""
    content_type: str = ""
    source: str = ""
    title: str = ""
    preview: str = ""
    tags: str = ""
    description: str = ""       # AI description (images)
    ocr_text: str = ""          # visible text in images
    url_title: str = ""         # fetched page title (URLs)
    image_file: str | None = None
    html_file: str | None = None


def _parse_frontmatter(filepath: str) -> dict:
    """Parse YAML frontmatter from a memory file."""
    try:
        with open(filepath, "r") as f:
            lines = f.readlines()
    except OSError:
        return {}

    if not lines or lines[0].strip() != "---":
        return {}

    meta = {}
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if ":" in line:
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip().strip('"')
    return meta


def _extract_body(filepath: str) -> str:
    """Extract the markdown body (after frontmatter)."""
    try:
        with open(filepath, "r") as f:
            content = f.read()
    except OSError:
        return ""

    if content.startswith("---"):
        end = content.find("---", 3)
        if end != -1:
            return content[end + 3:].strip()
    return content


def _extract_title(body: str) -> str:
    """Extract the first # heading from the body."""
    for line in body.split("\n"):
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:]
    return ""


def _extract_preview(body: str, max_length: int = 200) -> str:
    """Extract a preview from the body, skipping the title."""
    past_title = False
    for line in body.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith("# ") and not past_title:
            past_title = True
            continue
        if stripped.startswith("## AI Analysis"):
            continue
        if stripped.startswith("**From:**") or stripped.startswith("**Date:**"):
            continue
        if stripped:
            return stripped[:max_length]
    return ""


def build_entry(filepath: str) -> IndexEntry:
    """Build an index entry from a memory file."""
    meta = _parse_frontmatter(filepath)
    body = _extract_body(filepath)
    title = _extract_title(body)
    preview = _extract_preview(body)

    # Extract AI analysis section if present (for images)
    description = ""
    ocr_text = ""
    ai_section = ""
    if "## AI Analysis" in body:
        ai_section = body.split("## AI Analysis")[-1].strip()
        # Parse description/text/tags from the analysis
        for line in ai_section.split("\n"):
            if line.strip().startswith("description:"):
                description = line.split(":", 1)[1].strip()
            elif line.strip().startswith("text:") and "none" not in line.lower():
                ocr_text = line.split(":", 1)[1].strip()

    return IndexEntry(
        filepath=filepath,
        date=meta.get("date", ""),
        time=meta.get("time", ""),
        medium=meta.get("medium", ""),
        content_type=meta.get("type", ""),
        source=meta.get("source", ""),
        title=title,
        preview=preview,
        tags=meta.get("tags", ""),
        description=description or meta.get("description", ""),
        ocr_text=ocr_text or meta.get("ocr_text", ""),
        url_title=meta.get("title", ""),  # fetched page title
        image_file=meta.get("image"),
        html_file=meta.get("html"),
    )


def load_index(memories_dir: str | None = None) -> list[dict]:
    """Load the index from disk. Returns empty list if not found."""
    path = os.path.join(memories_dir, "index.json") if memories_dir else INDEX_PATH
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        logger.warning("Failed to load index from %s, returning empty", path)
        return []


def save_index(entries: list[dict], memories_dir: str | None = None) -> None:
    """Write the index to disk."""
    path = os.path.join(memories_dir, "index.json") if memories_dir else INDEX_PATH
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(entries, f, indent=2)
    logger.info("Saved index with %d entries to %s", len(entries), path)


def add_to_index(filepath: str, memories_dir: str | None = None) -> None:
    """Add or update a single entry in the index."""
    entries = load_index(memories_dir=memories_dir)

    # Remove existing entry for this file if present
    entries = [e for e in entries if e.get("filepath") != filepath]

    # Build and add new entry
    entry = build_entry(filepath)
    entries.append(asdict(entry))

    save_index(entries, memories_dir=memories_dir)
    logger.info("Indexed %s", filepath)


def rebuild_index(date_filter: str | None = None, memories_dir: str | None = None) -> int:
    """Rebuild the index by scanning memory files.

    Args:
        date_filter: If set, only reindex this date (YYYY-MM-DD).
                     If None, reindex everything.
        memories_dir: Override for the memories directory (identity-scoped).

    Returns:
        Number of entries indexed.
    """
    target_dir = memories_dir or MEMORIES_DIR

    if not os.path.isdir(target_dir):
        save_index([], memories_dir=memories_dir)
        return 0

    if date_filter:
        # Reindex a specific date — keep other dates, replace this one
        entries = [e for e in load_index(memories_dir=memories_dir) if e.get("date") != date_filter]
        day_dir = os.path.join(target_dir, date_filter)
        if os.path.isdir(day_dir):
            for filename in sorted(os.listdir(day_dir)):
                if filename.endswith(".md"):
                    filepath = os.path.join(day_dir, filename)
                    entries.append(asdict(build_entry(filepath)))
    else:
        # Full reindex
        entries = []
        for day_dir_name in sorted(os.listdir(target_dir)):
            day_dir = os.path.join(target_dir, day_dir_name)
            if not os.path.isdir(day_dir) or day_dir_name == "index.json":
                continue
            for filename in sorted(os.listdir(day_dir)):
                if filename.endswith(".md"):
                    filepath = os.path.join(day_dir, filename)
                    entries.append(asdict(build_entry(filepath)))

    save_index(entries, memories_dir=memories_dir)
    return len(entries)
