"""The observability event stream: append-only JSONL, the public contract that
external tools (e.g. studio-console) consume. Schema documented in
docs/architecture/07-observability.md — additive changes only within v=1.

File append order is canonical; `seq` is per-writer advisory (concurrent CLI +
watch processes may interleave, and sub-4KB line appends are atomic on POSIX).
"""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime
from pathlib import Path

SCHEMA_VERSION = 1
MAX_BYTES_DEFAULT = 10 * 1024 * 1024

# Excerpt fields are capped centrally; full text lives in the pointed-at files.
TAIL_CAPS = {"output_tail": 2000, "comment_tail": 2000, "gate_tail": 1000, "chunk": 2000}


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


class OutputCoalescer:
    """Batches an agent's incremental output into agent_output events.

    Raw model deltas would flood the stream; this flushes when >= max_chars
    accumulate or >= max_interval_s has passed since the last flush, on channel
    change (a tool notice shouldn't ride inside prose), and finally on close()
    with done=True. A 5-minute invocation yields tens of events, not thousands.
    """

    def __init__(self, events, *, max_chars: int = 400, max_interval_s: float = 1.0,
                 clock=time.monotonic) -> None:
        self.events = events
        self.max_chars = max_chars
        self.max_interval_s = max_interval_s
        self.clock = clock
        self._buffer = ""
        self._channel = "text"
        self._last_flush = clock()
        self._closed = False

    def _flush(self, done: bool = False) -> None:
        if self._buffer or done:
            self.events.emit("agent_output", chunk=self._buffer, channel=self._channel, done=done)
        self._buffer = ""
        self._last_flush = self.clock()

    def feed(self, chunk: str, channel: str = "text") -> None:
        if self._closed or not chunk:
            return
        if channel != self._channel and self._buffer:
            self._flush()
        self._channel = channel
        self._buffer += chunk
        if len(self._buffer) >= self.max_chars or (
            self.clock() - self._last_flush >= self.max_interval_s
        ):
            self._flush()

    def close(self) -> None:
        if not self._closed:
            self._flush(done=True)
            self._closed = True
