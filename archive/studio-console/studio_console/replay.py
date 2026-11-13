"""Replay a recorded event stream (dev/demo), and the headless --check mode."""

from __future__ import annotations

import time
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path

from studio_console.events import Event, parse_line
from studio_console.state import ConsoleState


def load_events(path: Path) -> tuple[list[Event], int]:
    """Parse a whole stream; returns (events, error_count)."""
    events, errors = [], 0
    for line in Path(path).read_text().splitlines():
        try:
            event = parse_line(line)
        except ValueError:
            errors += 1
            continue
        if event is not None:
            events.append(event)
    return events, errors


def _seconds_between(a: str, b: str) -> float:
    try:
        return max(0.0, (datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds())
    except ValueError:
        return 0.0


def replay(path: Path, speed: float = 10.0, sleep=time.sleep) -> Iterator[Event]:
    """Yield events with (scaled) original timing between them."""
    events, _ = load_events(path)
    previous: Event | None = None
    for event in events:
        if previous is not None and speed > 0:
            sleep(min(_seconds_between(previous.ts, event.ts) / speed, 2.0))
        previous = event
        yield event


def check(path: Path) -> tuple[str, bool]:
    """Headless smoke: parse everything, fold state, summarize. ok = parsed
    cleanly and saw at least one event."""
    state = ConsoleState()
    events, errors = load_events(path)
    state.parse_errors = errors
    for event in events:
        state.apply(event)
    ok = state.healthy
    return state.summary() + ("\nOK" if ok else "\nNOT OK"), ok
