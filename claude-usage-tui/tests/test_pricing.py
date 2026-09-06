from datetime import datetime, timezone

import pytest

from claude_usage.pricing import cost_usd
from claude_usage.transcripts import Record


def usage(model, **kw):
    defaults = dict(
        kind="usage",
        timestamp=datetime(2026, 9, 5, tzinfo=timezone.utc),
        model=model,
        input_tokens=0,
        output_tokens=0,
        cache_read_tokens=0,
        cache_create_5m_tokens=0,
        cache_create_1h_tokens=0,
    )
    defaults.update(kw)
    return Record(**defaults)


def test_fable_full_cost_breakdown():
    rec = usage(
        "claude-fable-5",
        input_tokens=2,
        output_tokens=100,
        cache_read_tokens=5000,
        cache_create_5m_tokens=100,
        cache_create_1h_tokens=200,
    )
    # in 2*$10 + out 100*$50 + read 5000*$1 + 5m 100*$12.50 + 1h 200*$20, per MTok
    expected = (2 * 10 + 100 * 50 + 5000 * 1 + 100 * 12.5 + 200 * 20) / 1e6
    assert cost_usd(rec) == pytest.approx(expected)


def test_opus_and_haiku_rates():
    assert cost_usd(usage("claude-opus-5", output_tokens=1_000_000)) == pytest.approx(25.0)
    assert cost_usd(usage("claude-haiku-4-5-20251001", input_tokens=1_000_000)) == pytest.approx(1.0)


def test_unknown_model_uses_fallback_rate():
    assert cost_usd(usage("mystery-model", input_tokens=1_000_000)) > 0
