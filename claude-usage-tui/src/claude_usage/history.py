"""Historical aggregations: daily series, hour-of-week heatmap, top projects."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from claude_usage.pricing import cost_usd
from claude_usage.transcripts import Record


@dataclass
class DayStat:
    date: date
    prompts: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float = 0.0


def daily_series(records: list[Record], now: datetime, days: int = 30) -> list[DayStat]:
    today = now.astimezone().date()
    series = {today - timedelta(days=i): DayStat(date=today - timedelta(days=i))
              for i in range(days)}
    for rec in records:
        day = series.get(rec.timestamp.astimezone().date())
        if day is None:
            continue
        if rec.kind == "prompt":
            day.prompts += 1
            continue
        day.output_tokens += rec.output_tokens
        day.total_tokens += rec.output_tokens + rec.context_tokens
        day.cost_usd += cost_usd(rec)
    return [series[d] for d in sorted(series)]


def hour_heatmap(records: list[Record], now: datetime, days: int = 30) -> list[list[int]]:
    """7x24 grid (weekday x local hour) of API-call counts."""
    grid = [[0] * 24 for _ in range(7)]
    cutoff = now - timedelta(days=days)
    for rec in records:
        if rec.kind != "usage" or rec.timestamp < cutoff:
            continue
        local = rec.timestamp.astimezone()
        grid[local.weekday()][local.hour] += 1
    return grid


def top_projects(records: list[Record], limit: int = 5) -> list[tuple[str, float]]:
    costs: Counter[str] = Counter()
    for rec in records:
        if rec.kind != "usage":
            continue
        name = rec.cwd.rsplit("/", 1)[-1] if rec.cwd else (
            rec.source.parent.name if rec.source else "?"
        )
        costs[name] += cost_usd(rec)
    return costs.most_common(limit)
