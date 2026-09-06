"""Burn rate over the recent window and rate-limit exhaustion projection."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta

from claude_usage.pricing import cost_usd
from claude_usage.transcripts import Record

MIN_PROJECTION_SPAN_SECONDS = 180


@dataclass
class BurnRate:
    output_tokens_per_min: float
    cost_per_hour: float
    calls: int


def burn_rate(records: list[Record], now: datetime, minutes: int = 60) -> BurnRate:
    cutoff = now - timedelta(minutes=minutes)
    out = cost = calls = 0
    for rec in records:
        if rec.kind != "usage" or rec.timestamp < cutoff:
            continue
        out += rec.output_tokens
        cost += cost_usd(rec)
        calls += 1
    return BurnRate(
        output_tokens_per_min=out / minutes,
        cost_per_hour=cost * 60 / minutes,
        calls=calls,
    )


def project_exhaustion(
    samples: list[tuple[datetime, float]], now: datetime
) -> datetime | None:
    """Linear extrapolation of meter samples (time, percent) to 100%."""
    if len(samples) < 2:
        return None
    (t0, p0), (t1, p1) = samples[0], samples[-1]
    span = (t1 - t0).total_seconds()
    if span < MIN_PROJECTION_SPAN_SECONDS or p1 <= p0:
        return None
    rate = (p1 - p0) / span  # percent per second
    return now + timedelta(seconds=(100.0 - p1) / rate)
