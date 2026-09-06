"""Tail an append-only JSONL file, surviving rotation, truncation, and files
that don't exist yet. Poll-based: cheap, portable, no watchers."""

from __future__ import annotations

from pathlib import Path


class EventTailer:
    _SIG_LEN = 64

    def __init__(self, path: Path) -> None:
        self.path = Path(path)
        self._pos = 0
        self._partial = ""
        self._signature = b""

    def _head(self, n: int) -> bytes:
        with self.path.open("rb") as fh:
            return fh.read(n)

    def poll(self) -> list[str]:
        """Complete new lines since the last poll (a trailing partial line is
        buffered until its newline arrives)."""
        if not self.path.is_file():
            self._pos, self._partial, self._signature = 0, "", b""
            return []
        size = self.path.stat().st_size
        head = self._head(min(self._SIG_LEN, size))
        if size < self._pos or (self._signature and not head.startswith(self._signature)):
            # rotated, truncated, or rewritten in place — start over
            self._pos, self._partial, self._signature = 0, "", b""
        if not self._signature and head:
            self._signature = head  # prefix fingerprint, fixed at first sight
        if size == self._pos:
            return []
        with self.path.open("r") as fh:
            fh.seek(self._pos)
            chunk = fh.read()
            self._pos = fh.tell()
        text = self._partial + chunk
        lines = text.split("\n")
        self._partial = lines.pop()  # "" when chunk ended in a newline
        return [line for line in lines if line.strip()]
