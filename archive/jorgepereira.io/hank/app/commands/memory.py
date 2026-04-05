"""Memory command — list saved memories for a given date.

Usage:
    /memory              — list today's memories
    /memory today        — same as above
    /memory yesterday    — list yesterday's memories
    /memory 2026-04-05   — list memories from a specific date
"""

import os
import re
from datetime import datetime, timedelta, timezone

from app.actions.remember import MEMORIES_DIR
from app.message import Message, TableMessage, TextMessage


def _parse_date(args: str) -> str:
    """Parse a date argument into YYYY-MM-DD format.

    Accepts: "today", "yesterday", "2026-04-05", or empty (defaults to today).
    """
    args = args.strip().lower()
    today = datetime.now(timezone.utc).date()

    if not args or args == "today":
        return today.isoformat()
    elif args == "yesterday":
        return (today - timedelta(days=1)).isoformat()
    else:
        # Try to parse as a date
        try:
            return datetime.strptime(args, "%Y-%m-%d").date().isoformat()
        except ValueError:
            return ""


def _extract_preview(filepath: str, max_length: int = 60) -> str:
    """Read a memory file and extract a short preview of the body.

    Skips YAML frontmatter, the title line, and blank lines.
    Returns the first line of actual body content.
    """
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
        i += 1  # skip closing ---

    # Skip title (# ...) and blank lines, find first body line
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
        # Found a body line
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

    # Skip YAML frontmatter (--- ... ---)
    i = 0
    if lines and lines[0].strip() == "---":
        i = 1
        while i < len(lines) and lines[i].strip() != "---":
            i += 1
        i += 1  # skip closing ---

    # Find the first # title after frontmatter
    while i < len(lines):
        stripped = lines[i].strip()
        if stripped.startswith("# "):
            return stripped[2:]
        if stripped:  # non-empty, non-title line
            return stripped[:60]
        i += 1

    return "(untitled)"


async def memory_handler(args: str, chat_id: int, channel: str) -> Message:
    """List saved memories for a given date."""
    date_str = _parse_date(args)
    if not date_str:
        return TextMessage(f"Invalid date: {args}\n\nUsage: /memory [today|yesterday|YYYY-MM-DD]")

    day_dir = os.path.join(MEMORIES_DIR, date_str)

    if not os.path.isdir(day_dir):
        return TextMessage(f"No memories for {date_str}.")

    # List all .md files, sorted by name (which starts with timestamp)
    files = sorted(f for f in os.listdir(day_dir) if f.endswith(".md"))

    if not files:
        return TextMessage(f"No memories for {date_str}.")

    # Build table rows: time, title, preview
    rows = []
    for filename in files:
        filepath = os.path.join(day_dir, filename)

        # Extract time from filename: 2026-04-05T21-33-02_slug.md → 21:33
        time_match = re.search(r"T(\d{2})-(\d{2})", filename)
        time_str = f"{time_match.group(1)}:{time_match.group(2)}" if time_match else "??:??"

        title = _extract_title(filepath)
        preview = _extract_preview(filepath)
        rows.append([time_str, title, preview])

    return TableMessage(
        title=f"Memories for {date_str}",
        headers=["Time", "Subject", "Preview"],
        rows=rows,
        footer=f"{len(rows)} {'memory' if len(rows) == 1 else 'memories'} saved on this date.",
        telegram_columns=[0, 1],  # Telegram: just time + subject
    )
