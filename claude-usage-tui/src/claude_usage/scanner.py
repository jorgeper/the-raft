"""Incremental scan of ~/.claude/projects/**/*.jsonl transcripts.

Keeps byte offsets per file so refreshes only read appended data, and
dedups usage records by (message id, request id) across files — continued
sessions copy earlier lines into new files.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from claude_usage.transcripts import Record, parse_line


@dataclass
class ScanState:
    offsets: dict[Path, int] = field(default_factory=dict)
    seen: set[tuple[str, str]] = field(default_factory=set)


def scan_transcripts(root: Path, state: ScanState) -> list[Record]:
    records: list[Record] = []
    for path in root.glob("**/*.jsonl"):
        offset = state.offsets.get(path, 0)
        try:
            size = path.stat().st_size
            if size <= offset:
                if size < offset:  # truncated/rewritten file: rescan
                    state.offsets[path] = 0
                continue
            with path.open("rb") as fh:
                fh.seek(offset)
                data = fh.read()
        except OSError:
            continue

        lines = data.split(b"\n")
        # Don't consume a trailing partial line still being written.
        partial = lines.pop() if not data.endswith(b"\n") else b""
        state.offsets[path] = offset + len(data) - len(partial)

        for raw in lines:
            if not raw.strip():
                continue
            rec = parse_line(raw.decode("utf-8", errors="replace"))
            if rec is None:
                continue
            if rec.kind == "usage" and rec.dedup_key != ("", ""):
                if rec.dedup_key in state.seen:
                    continue
                state.seen.add(rec.dedup_key)
            records.append(rec)
    return records
