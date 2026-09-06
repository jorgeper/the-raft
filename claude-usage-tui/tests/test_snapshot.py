from datetime import datetime, timedelta, timezone

from claude_usage.aggregate import Totals
from claude_usage.limits import Limit
from claude_usage.snapshot import snapshot_text


def test_snapshot_renders_limits_and_stats_as_plain_text():
    limits = [
        Limit(kind="session", percent=56, resets_at=datetime.now(timezone.utc) + timedelta(hours=2))
    ]
    stats = {
        "today": Totals(prompts=10, output_tokens=1000, cost_usd=1.23),
        "7d": Totals(prompts=20, output_tokens=2000, cost_usd=4.56),
        "30d": Totals(prompts=30, output_tokens=3000, cost_usd=7.89),
    }
    text = snapshot_text(limits, stats)
    assert "Session (5h)" in text
    assert "56%" in text
    assert "Today" in text
    assert "$7.89" in text


def test_snapshot_notes_when_limits_unavailable():
    stats = {"today": Totals(), "7d": Totals(), "30d": Totals()}
    text = snapshot_text(None, stats)
    assert "unavailable" in text
