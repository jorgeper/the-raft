"""Aggregate parsed records into today / 7d / 30d windows."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from claude_usage.pricing import cost_usd
from claude_usage.transcripts import Record


@dataclass
class Totals:
    prompts: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cost_usd: float = 0.0
    by_model: dict[str, "Totals"] = field(default_factory=dict)

    def add(self, rec: Record) -> None:
        if rec.kind == "prompt":
            self.prompts += 1
            return
        self.input_tokens += rec.input_tokens
        self.output_tokens += rec.output_tokens
        self.cache_read_tokens += rec.cache_read_tokens
        self.cache_write_tokens += rec.cache_create_5m_tokens + rec.cache_create_1h_tokens
        self.cost_usd += cost_usd(rec)


def aggregate(records: list[Record], now: datetime) -> dict[str, Totals]:
    today_start = now.astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    cutoffs = {
        "today": today_start,
        "7d": now - timedelta(days=7),
        "30d": now - timedelta(days=30),
    }
    stats = {name: Totals() for name in cutoffs}
    for rec in records:
        for name, cutoff in cutoffs.items():
            if rec.timestamp >= cutoff:
                totals = stats[name]
                totals.add(rec)
                if rec.kind == "usage":
                    totals.by_model.setdefault(rec.model, Totals()).add(rec)
    return stats
