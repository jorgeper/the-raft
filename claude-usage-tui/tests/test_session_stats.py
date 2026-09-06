from datetime import datetime, timedelta, timezone
from pathlib import Path

from claude_usage.session_stats import session_stats
from claude_usage.transcripts import Record

NOW = datetime(2026, 9, 5, 20, 0, tzinfo=timezone.utc)
A = Path("/p/a.jsonl")
B = Path("/p/b.jsonl")


def rec(source, mins_ago, kind="usage", **kw):
    defaults = dict(kind=kind, timestamp=NOW - timedelta(minutes=mins_ago), source=source)
    defaults.update(kw)
    return Record(**defaults)


def test_groups_by_source_with_duration_prompts_and_context():
    records = [
        rec(A, 60, kind="prompt"),
        rec(A, 59, model="claude-fable-5", cache_read_tokens=100_000, output_tokens=50,
            git_branch="main", cwd="/x/proj", tools=["Bash"]),
        rec(A, 5, kind="prompt"),
        rec(A, 1, model="claude-fable-5", cache_read_tokens=400_000, input_tokens=10,
            output_tokens=99, git_branch="feat", cwd="/x/proj", tools=["Read", "Edit"]),
        rec(B, 30, model="claude-opus-5", output_tokens=1),
    ]
    stats = session_stats(records)
    a = stats[A]
    assert a.prompts == 2
    assert a.duration.total_seconds() == 59 * 60
    assert a.model == "claude-fable-5"
    assert a.git_branch == "feat"
    assert a.context_tokens == 400_010  # from the latest main-chain call
    assert a.last_tool == "Edit"
    assert a.cost_usd > 0
    assert stats[B].model == "claude-opus-5"


def test_sidechain_calls_counted_but_do_not_set_context():
    records = [
        rec(A, 10, model="claude-fable-5", cache_read_tokens=500_000),
        rec(A, 1, model="claude-haiku-4-5", cache_read_tokens=9_000, is_sidechain=True),
    ]
    stats = session_stats(records)
    assert stats[A].subagent_calls == 1
    assert stats[A].context_tokens == 500_000
