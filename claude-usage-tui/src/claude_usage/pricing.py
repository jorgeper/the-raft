"""API-equivalent cost estimation. Prices in USD per million tokens.

Cache multipliers per Anthropic pricing: read 0.1x input, 5m write 1.25x,
1h write 2x. Table cached 2026-09; unknown models fall back to Opus rates.
"""

from __future__ import annotations

from claude_usage.transcripts import Record

# Substring match, first hit wins — order matters (legacy Opus 4/4.1 were $15/$75).
_RATES: list[tuple[str, float, float]] = [
    ("fable", 10.0, 50.0),
    ("mythos", 10.0, 50.0),
    ("opus-4-1", 15.0, 75.0),
    ("opus-4-2025", 15.0, 75.0),
    ("opus", 5.0, 25.0),
    ("sonnet", 3.0, 15.0),
    ("haiku-4", 1.0, 5.0),
    ("haiku-3-5", 0.8, 4.0),
    ("haiku", 0.25, 1.25),
]
_FALLBACK = (5.0, 25.0)


def rates_for(model: str) -> tuple[float, float]:
    for needle, inp, out in _RATES:
        if needle in model:
            return inp, out
    return _FALLBACK


def cost_usd(rec: Record) -> float:
    inp, out = rates_for(rec.model)
    return (
        rec.input_tokens * inp
        + rec.output_tokens * out
        + rec.cache_read_tokens * inp * 0.1
        + rec.cache_create_5m_tokens * inp * 1.25
        + rec.cache_create_1h_tokens * inp * 2.0
    ) / 1e6
