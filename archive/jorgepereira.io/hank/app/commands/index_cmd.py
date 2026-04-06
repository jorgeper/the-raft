"""Index command — rebuild the memory search index.

Usage:
    /index              — reindex all memories
    /index today        — reindex today's memories only
    /index 2026-04-05   — reindex a specific date
"""

from datetime import datetime, timedelta, timezone

from app.memory_index import rebuild_index


def _parse_date(args: str) -> str | None:
    """Parse a date argument. Returns None for 'all' (no filter)."""
    args = args.strip().lower()
    today = datetime.now(timezone.utc).date()

    if not args:
        return None  # reindex everything
    elif args == "today":
        return today.isoformat()
    elif args == "yesterday":
        return (today - timedelta(days=1)).isoformat()
    else:
        try:
            return datetime.strptime(args, "%Y-%m-%d").date().isoformat()
        except ValueError:
            return ""  # invalid


async def index_handler(args: str, chat_id: int, channel: str) -> str:
    """Rebuild the memory index."""
    date_filter = _parse_date(args)

    if date_filter == "":
        return f"Invalid date: {args}\n\nUsage: /index [today|yesterday|YYYY-MM-DD]"

    count = rebuild_index(date_filter=date_filter)

    if date_filter:
        return f"Reindexed {count} memories for {date_filter}."
    return f"Reindexed all memories ({count} entries)."
