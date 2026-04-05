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

    Skips the title line and metadata, returns the first line of actual content.
    """
    try:
        with open(filepath, "r") as f:
            lines = f.readlines()
    except OSError:
        return "(unreadable)"

    # Skip title (# ...), blank lines, metadata (**From:**, **Date:**), and ---
    body_started = False
    for line in lines:
        stripped = line.strip()
        if stripped == "---":
            body_started = True
            continue
        if body_started and stripped:
            # Truncate long previews
            if len(stripped) > max_length:
                return stripped[:max_length] + "..."
            return stripped

    return "(empty)"


def _extract_title(filepath: str) -> str:
    """Read the title (first # line) from a memory file."""
    try:
        with open(filepath, "r") as f:
            first_line = f.readline().strip()
            if first_line.startswith("# "):
                return first_line[2:]
            return first_line
    except OSError:
        return "(unreadable)"


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
