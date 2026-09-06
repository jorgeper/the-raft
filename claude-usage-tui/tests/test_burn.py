from datetime import datetime, timedelta, timezone

from claude_usage.burn import burn_rate, project_exhaustion
from claude_usage.transcripts import Record

NOW = datetime(2026, 9, 5, 20, 0, tzinfo=timezone.utc)


def test_burn_rate_measures_recent_output_pace():
    records = [
        Record(kind="usage", timestamp=NOW - timedelta(minutes=m),
               model="claude-opus-5", output_tokens=600)
        for m in (5, 15, 25)
    ] + [
        Record(kind="usage", timestamp=NOW - timedelta(hours=3),
               model="claude-opus-5", output_tokens=999_999)  # outside window
    ]
    rate = burn_rate(records, now=NOW, minutes=60)
    assert rate.output_tokens_per_min == 1800 / 60
    assert rate.cost_per_hour > 0


def test_projection_extrapolates_to_100_percent():
    samples = [(NOW - timedelta(minutes=30), 40.0), (NOW, 55.0)]
    eta = project_exhaustion(samples, now=NOW)
    # 15%/30min -> 45% left = 90 minutes
    assert abs((eta - NOW).total_seconds() - 90 * 60) < 60


def test_projection_needs_rising_data():
    assert project_exhaustion([(NOW, 50.0)], now=NOW) is None
    flat = [(NOW - timedelta(minutes=30), 50.0), (NOW, 50.0)]
    assert project_exhaustion(flat, now=NOW) is None
