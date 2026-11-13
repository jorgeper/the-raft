from datetime import datetime, timedelta, timezone
from pathlib import Path

from claude_usage.history import daily_series, hour_heatmap, top_projects
from claude_usage.transcripts import Record

NOW = datetime(2026, 9, 5, 20, 0, tzinfo=timezone.utc)


def usage_at(ts, out=10, cwd="/x/proj", source=Path("/p/-x-proj/s.jsonl")):
    return Record(
        kind="usage", timestamp=ts, model="claude-opus-5",
        output_tokens=out, cwd=cwd, source=source,
    )


def test_daily_series_covers_every_day_oldest_first():
    records = [
        usage_at(NOW - timedelta(hours=1), out=100),
        usage_at(NOW - timedelta(days=2), out=30),
        Record(kind="prompt", timestamp=NOW - timedelta(days=2)),
    ]
    days = daily_series(records, now=NOW, days=7)
    assert len(days) == 7
    assert days[-1].output_tokens == 100
    assert days[-3].output_tokens == 30
    assert days[-3].prompts == 1
    assert days[0].output_tokens == 0
    assert days[0].date < days[-1].date


def test_hour_heatmap_buckets_by_local_weekday_and_hour():
    records = [usage_at(NOW - timedelta(hours=1)), usage_at(NOW - timedelta(hours=1))]
    grid = hour_heatmap(records, now=NOW, days=30)
    assert len(grid) == 7 and all(len(row) == 24 for row in grid)
    local = (NOW - timedelta(hours=1)).astimezone()
    assert grid[local.weekday()][local.hour] == 2


def test_top_projects_ranks_by_cost():
    records = [
        usage_at(NOW, out=1000, cwd="/x/big"),
        usage_at(NOW, out=10, cwd="/x/small"),
        usage_at(NOW, out=990, cwd="/x/big"),
    ]
    top = top_projects(records)
    assert top[0][0] == "big"
    assert top[0][1] > top[1][1]
