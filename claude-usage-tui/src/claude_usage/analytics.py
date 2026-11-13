"""Tool and efficiency analytics over a set of records."""

from __future__ import annotations

from collections import Counter

from claude_usage.pricing import cost_usd
from claude_usage.transcripts import Record


def tool_counts(records: list[Record]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for rec in records:
        counts.update(rec.tools)
    return counts


def cache_hit_rate(records: list[Record]) -> float:
    read = total = 0
    for rec in records:
        if rec.kind != "usage":
            continue
        read += rec.cache_read_tokens
        total += rec.context_tokens
    return read / total if total else 0.0


def sidechain_share(records: list[Record]) -> tuple[float, float]:
    """(subagent cost, total cost) over the given records."""
    side = total = 0.0
    for rec in records:
        if rec.kind != "usage":
            continue
        c = cost_usd(rec)
        total += c
        if rec.is_sidechain:
            side += c
    return side, total
