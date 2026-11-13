from datetime import datetime, timezone

import pytest

from claude_usage.analytics import cache_hit_rate, sidechain_share, tool_counts
from claude_usage.transcripts import Record

TS = datetime(2026, 9, 5, tzinfo=timezone.utc)


def usage(**kw):
    defaults = dict(kind="usage", timestamp=TS, model="claude-opus-5")
    defaults.update(kw)
    return Record(**defaults)


def test_tool_counts_across_records():
    records = [usage(tools=["Bash", "Edit"]), usage(tools=["Bash"])]
    assert tool_counts(records).most_common(1) == [("Bash", 2)]


def test_cache_hit_rate():
    records = [usage(input_tokens=50, cache_read_tokens=900, cache_create_5m_tokens=50)]
    assert cache_hit_rate(records) == pytest.approx(0.9)


def test_sidechain_share_of_cost():
    records = [
        usage(output_tokens=1000),
        usage(output_tokens=1000, is_sidechain=True),
    ]
    side, total = sidechain_share(records)
    assert side == pytest.approx(total / 2)
