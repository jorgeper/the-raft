"""Reflection: the harness parses `LESSON:` lines out of agent output and
persists them to the role journal itself (self-improve-spec §5).

Agents may still append to their journals directly; this path exists so that
reflection is guaranteed rather than advisory — a run whose lessons never get
written cannot happen when the harness does the writing.
"""

from __future__ import annotations

import re
from pathlib import Path

from studio.events import NullEventLog

LESSON_RE = re.compile(r"^LESSON:[ \t]*(\S.*)$", re.MULTILINE)
MAX_LESSONS_PER_RUN = 3
MAX_LESSON_CHARS = 200


def extract_lessons(output: str) -> list[str]:
    return [match.strip() for match in LESSON_RE.findall(output or "")]


def harvest_lessons(
    output: str,
    journal_path: Path,
    *,
    item_id: str,
    agent: str,
    events=None,
) -> list[str]:
    """Persist up to MAX_LESSONS_PER_RUN lessons from one run's output.

    Returns the lessons kept. No LESSON lines is not an error (R14); nothing is
    written and no file is created.
    """
    events = events or NullEventLog()
    found = extract_lessons(output)
    if not found:
        return []
    kept = [lesson[:MAX_LESSON_CHARS] for lesson in found[:MAX_LESSONS_PER_RUN]]
    journal_path = Path(journal_path)
    journal_path.parent.mkdir(parents=True, exist_ok=True)
    with journal_path.open("a") as fh:
        for lesson in kept:
            fh.write(f"- [#{item_id}] {lesson}\n")
    for lesson in kept:
        events.emit("lesson", item=item_id, agent=agent, text=lesson)
    if len(found) > len(kept):
        events.emit("lessons_dropped", item=item_id, agent=agent, count=len(found) - len(kept))
    return kept
