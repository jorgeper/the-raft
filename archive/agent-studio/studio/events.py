"""The observability event stream: append-only JSONL, the public contract that
external tools (e.g. studio-console) consume. Schema documented in
docs/architecture/07-observability.md — additive changes only within v=1.

File append order is canonical; `seq` is per-writer advisory (concurrent CLI +
watch processes may interleave, and sub-4KB line appends are atomic on POSIX).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

SCHEMA_VERSION = 1
MAX_BYTES_DEFAULT = 10 * 1024 * 1024

# Excerpt fields are capped centrally; full text lives in the pointed-at files.
TAIL_CAPS = {"output_tail": 2000, "comment_tail": 2000, "gate_tail": 1000}


class NullEventLog:
    """Default sink: emits nowhere. Keeps every component observability-optional."""

    def emit(self, event: str, *, item: str | None = None, agent: str | None = None, **data) -> None:
        pass

    def bound(self, *, item: str | None = None, agent: str | None = None) -> NullEventLog:
        return self


class EventLog:
    def __init__(self, path: Path, max_bytes: int = MAX_BYTES_DEFAULT) -> None:
        self.path = Path(path)
        self.max_bytes = max_bytes
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._seq = self._count_lines()

    def _count_lines(self) -> int:
        if not self.path.is_file():
            return 0
        with self.path.open("rb") as fh:
            return sum(1 for _ in fh)

    def _rotate_if_needed(self) -> None:
        try:
            if self.path.is_file() and self.path.stat().st_size > self.max_bytes:
                self.path.replace(self.path.with_suffix(self.path.suffix + ".1"))
        except OSError:
            pass  # observability must never break the work

    def emit(self, event: str, *, item: str | None = None, agent: str | None = None, **data) -> None:
        for field, cap in TAIL_CAPS.items():
            if field in data and isinstance(data[field], str) and len(data[field]) > cap:
                data[field] = data[field][-cap:]
        self._seq += 1
        record = {
            "v": SCHEMA_VERSION,
            "seq": self._seq,
            "ts": datetime.now(UTC).isoformat(timespec="seconds"),
            "kind": event,
            "item": item,
            "agent": agent,
            "data": data,
        }
        self._rotate_if_needed()
        try:
            with self.path.open("a") as fh:
                fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        except OSError:
            pass

    def bound(self, *, item: str | None = None, agent: str | None = None) -> BoundEventLog:
        return BoundEventLog(self, item=item, agent=agent)


class BoundEventLog:
    """An EventLog view with item/agent pre-filled — handed to components (the
    GoalLoop) that don't know which work item they're serving."""

    def __init__(self, log: EventLog, *, item: str | None, agent: str | None) -> None:
        self._log = log
        self._item = item
        self._agent = agent

    def emit(self, event: str, *, item: str | None = None, agent: str | None = None, **data) -> None:
        self._log.emit(event, item=item or self._item, agent=agent or self._agent, **data)

    def bound(self, *, item: str | None = None, agent: str | None = None) -> BoundEventLog:
        return BoundEventLog(self._log, item=item or self._item, agent=agent or self._agent)
