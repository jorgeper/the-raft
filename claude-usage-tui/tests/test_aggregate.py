from datetime import datetime, timedelta, timezone

from claude_usage.aggregate import aggregate
from claude_usage.transcripts import Record

NOW = datetime(2026, 9, 5, 20, 0, tzinfo=timezone.utc)


def usage_at(ts, model="claude-fable-5", out=10):
    return Record(kind="usage", timestamp=ts, model=model, output_tokens=out)


def prompt_at(ts):
    return Record(kind="prompt", timestamp=ts)


def test_windows_bucket_by_age():
    records = [
        usage_at(NOW - timedelta(hours=1)),          # today, 7d, 30d
        usage_at(NOW - timedelta(days=3)),           # 7d, 30d
        usage_at(NOW - timedelta(days=20)),          # 30d only
        usage_at(NOW - timedelta(days=40)),          # outside all windows
        prompt_at(NOW - timedelta(hours=2)),
        prompt_at(NOW - timedelta(days=3)),
    ]
    stats = aggregate(records, now=NOW)
    assert stats["today"].prompts == 1
    assert stats["today"].output_tokens == 10
    assert stats["7d"].prompts == 2
    assert stats["7d"].output_tokens == 20
    assert stats["30d"].output_tokens == 30
    assert stats["30d"].cost_usd > stats["7d"].cost_usd


def test_per_model_breakdown_over_30d():
    records = [
        usage_at(NOW - timedelta(hours=1), model="claude-fable-5", out=10),
        usage_at(NOW - timedelta(days=2), model="claude-opus-5", out=30),
        usage_at(NOW - timedelta(days=2), model="claude-opus-5", out=5),
    ]
    stats = aggregate(records, now=NOW)
    by_model = stats["30d"].by_model
    assert by_model["claude-fable-5"].output_tokens == 10
    assert by_model["claude-opus-5"].output_tokens == 35
