"""Memory command — list, inspect, and manage saved memories.

Usage:
    /memory              — list today's memories
    /memory today        — same as above
    /memory yesterday    — list yesterday's memories
    /memory 2026-04-05   — list memories from a specific date
    /memory last         — show the last saved memory with full metadata
    /memory wipe         — delete ALL memories
    /memory today wipe   — delete today's memories
    /memory 2026-04-05 wipe — delete memories for a specific date
"""

import os
import re
import shutil
from datetime import datetime, timedelta, timezone

from app.actions.remember import MEMORIES_DIR
from app.message import Message, TableMessage, TextMessage


def _parse_frontmatter(filepath: str) -> dict:
    """Parse YAML frontmatter from a memory file into a dict.

    Returns an empty dict if no frontmatter found.
    """
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


def _parse_date(args: str) -> str:
    """Parse a date argument into YYYY-MM-DD format."""
    args = args.strip().lower()
    today = datetime.now(timezone.utc).date()

    if not args or args == "today":
        return today.isoformat()
    elif args == "yesterday":
        return (today - timedelta(days=1)).isoformat()
    else:
        try:
            return datetime.strptime(args, "%Y-%m-%d").date().isoformat()
        except ValueError:
            return ""


def _extract_preview(filepath: str, max_length: int = 60) -> str:
    """Read a memory file and extract a short preview of the body."""
    try:
        with open(filepath, "r") as f:
            lines = f.readlines()
    except OSError:
        return "(unreadable)"

    # Skip YAML frontmatter
    i = 0
    if lines and lines[0].strip() == "---":
        i = 1
        while i < len(lines) and lines[i].strip() != "---":
            i += 1
        i += 1

    # Skip title and blank lines, find first body line
    past_title = False
    while i < len(lines):
        stripped = lines[i].strip()
        if not stripped:
            i += 1
            continue
        if stripped.startswith("# ") and not past_title:
            past_title = True
            i += 1
            continue
        if len(stripped) > max_length:
            return stripped[:max_length] + "..."
        return stripped
        i += 1

    return "(empty)"


def _extract_title(filepath: str) -> str:
    """Read the title (first # line) from a memory file, skipping frontmatter."""
    try:
        with open(filepath, "r") as f:
            lines = f.readlines()
    except OSError:
        return "(unreadable)"

    i = 0
    if lines and lines[0].strip() == "---":
        i = 1
        while i < len(lines) and lines[i].strip() != "---":
            i += 1
        i += 1

    while i < len(lines):
        stripped = lines[i].strip()
        if stripped.startswith("# "):
            return stripped[2:]
        if stripped:
            return stripped[:60]
        i += 1

    return "(untitled)"


def _find_last_memory() -> str | None:
    """Find the most recent memory file across all date folders.

    Returns the filepath or None if no memories exist.
    """
    if not os.path.isdir(MEMORIES_DIR):
        return None

    # Date folders are sorted alphabetically = chronologically
    day_dirs = sorted(
        (d for d in os.listdir(MEMORIES_DIR) if os.path.isdir(os.path.join(MEMORIES_DIR, d))),
        reverse=True,
    )

    for day_dir in day_dirs:
        full_dir = os.path.join(MEMORIES_DIR, day_dir)
        files = sorted((f for f in os.listdir(full_dir) if f.endswith(".md")), reverse=True)
        if files:
            return os.path.join(full_dir, files[0])

    return None


def _render_last_memory(filepath: str, channel: str) -> str:
    """Render the last memory with full metadata and content preview."""
    meta = _parse_frontmatter(filepath)
    title = _extract_title(filepath)
    preview = _extract_preview(filepath, max_length=200)

    meta_lines = []
    for key in ["date", "time", "medium", "type", "source", "title", "tags"]:
        if key in meta and meta[key] and meta[key] != "[]":
            meta_lines.append((key, meta[key]))

    if channel == "telegram":
        lines = [f"📌 {title}", ""]
        for key, value in meta_lines:
            lines.append(f"{key}: {value}")
        lines.extend(["", preview])
        return "\n".join(lines)
    else:
        lines = [f"Last saved memory: {title}", ""]
        for key, value in meta_lines:
            lines.append(f"**{key}:** {value}")
        lines.extend(["", "---", "", preview])
        return "\n".join(lines)


def _wipe_date(date_str: str) -> tuple[int, str]:
    """Delete all memories for a specific date. Returns (count, message)."""
    day_dir = os.path.join(MEMORIES_DIR, date_str)
    if not os.path.isdir(day_dir):
        return 0, f"No memories for {date_str}."

    files = [f for f in os.listdir(day_dir) if f.endswith(".md")]
    count = len(files)
    shutil.rmtree(day_dir)
    return count, f"Deleted {count} {'memory' if count == 1 else 'memories'} for {date_str}."


def _wipe_all() -> tuple[int, str]:
    """Delete ALL memories. Returns (count, message)."""
    if not os.path.isdir(MEMORIES_DIR):
        return 0, "No memories to delete."

    total = 0
    for day_dir in os.listdir(MEMORIES_DIR):
        full_dir = os.path.join(MEMORIES_DIR, day_dir)
        if os.path.isdir(full_dir):
            total += len([f for f in os.listdir(full_dir) if f.endswith(".md")])
            shutil.rmtree(full_dir)

    return total, f"Deleted all memories ({total} files)."


async def memory_handler(args: str, chat_id: int, channel: str) -> Message:
    """List, inspect, or wipe saved memories."""
    parts = args.strip().lower().split()

    # /memory last
    if parts == ["last"]:
        filepath = _find_last_memory()
        if not filepath:
            return TextMessage("No memories saved yet.")
        return TextMessage(_render_last_memory(filepath, channel))

    # /memory wipe — delete ALL memories
    if parts == ["wipe"]:
        _, msg = _wipe_all()
        return TextMessage(msg)

    # /memory <date> wipe — delete memories for a specific date
    if len(parts) == 2 and parts[1] == "wipe":
        date_str = _parse_date(parts[0])
        if not date_str:
            return TextMessage(f"Invalid date: {parts[0]}")
        _, msg = _wipe_date(date_str)
        return TextMessage(msg)

    # /memory [today|yesterday|YYYY-MM-DD] — list memories for a date
    date_str = _parse_date(args)
    if not date_str:
        return TextMessage(f"Invalid date: {args}\n\nUsage: /memory [today|yesterday|YYYY-MM-DD|last|wipe]")

    day_dir = os.path.join(MEMORIES_DIR, date_str)

    if not os.path.isdir(day_dir):
        return TextMessage(f"No memories for {date_str}.")

    files = sorted(f for f in os.listdir(day_dir) if f.endswith(".md"))

    if not files:
        return TextMessage(f"No memories for {date_str}.")

    # Build table rows with metadata
    rows = []
    for filename in files:
        filepath = os.path.join(day_dir, filename)
        meta = _parse_frontmatter(filepath)

        time_match = re.search(r"T(\d{2})-(\d{2})", filename)
        time_str = f"{time_match.group(1)}:{time_match.group(2)}" if time_match else "??:??"

        title = _extract_title(filepath)
        content_type = meta.get("type", "?")
        medium = meta.get("medium", "?")
        preview = _extract_preview(filepath)

        rows.append([time_str, content_type, medium, title, preview])

    return TableMessage(
        title=f"Memories for {date_str}",
        headers=["Time", "Type", "Medium", "Subject", "Preview"],
        rows=rows,
        footer=f"{len(rows)} {'memory' if len(rows) == 1 else 'memories'} saved on this date.",
        telegram_columns=[0, 2, 3],  # Telegram: time + medium + subject
    )
