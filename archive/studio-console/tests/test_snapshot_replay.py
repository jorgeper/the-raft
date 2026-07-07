"""Snapshot client (faked subprocess seam), replay timing, and --check."""

import json
from pathlib import Path

from studio_console.replay import check, load_events, replay
from studio_console.snapshot import RunResult, SnapshotClient

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


class FakeRunner:
    def __init__(self, results):
        self.results = list(results)
        self.calls = []

    def __call__(self, argv, cwd=None, timeout_s=30):
        self.calls.append(argv)
        return self.results.pop(0)


def test_snapshot_status_builds_contract_argv(tmp_path):
    status_json = (FIXTURES / "demo-status.json").read_text()
    runner = FakeRunner([RunResult(0, status_json, "")])
    client = SnapshotClient(tmp_path / "studio", tmp_path / "py", runner=runner)
    snapshot = client.status()
    assert snapshot["items"][0]["state"] == "done"
    argv = runner.calls[0]
    assert argv[1:3] == ["-m", "studio"]
    assert "--json" in argv and "status" in argv
    assert str(tmp_path / "studio" / "config" / "studio.yaml") in argv


def test_snapshot_failure_returns_none(tmp_path):
    client = SnapshotClient(tmp_path, tmp_path, runner=FakeRunner([RunResult(1, "", "boom")]))
    assert client.status() is None
    client = SnapshotClient(tmp_path, tmp_path, runner=FakeRunner([RunResult(0, "not json", "")]))
    assert client.show("1") is None


def test_load_events_counts_errors(tmp_path):
    path = tmp_path / "e.jsonl"
    good = json.dumps({"v": 1, "kind": "tick_start", "data": {}})
    path.write_text(f"{good}\nnot json at all\n{good}\n")
    events, errors = load_events(path)
    assert len(events) == 2 and errors == 1


def test_replay_preserves_order_and_scales_time():
    sleeps = []
    events = list(replay(FIXTURES / "demo-events.jsonl", speed=100.0, sleep=sleeps.append))
    assert len(events) >= 40
    assert [e.seq for e in events] == sorted(e.seq for e in events)
    assert len(sleeps) == len(events) - 1
    assert all(s <= 2.0 for s in sleeps)  # capped gaps


def test_check_on_fixture_is_ok():
    summary, ok = check(FIXTURES / "demo-events.jsonl")
    assert ok
    assert summary.endswith("OK")
    assert "verified=" in summary


def test_check_on_garbage_is_not_ok(tmp_path):
    path = tmp_path / "e.jsonl"
    path.write_text("garbage\n")
    summary, ok = check(path)
    assert not ok and "NOT OK" in summary


def test_main_check_exit_codes(tmp_path, capsys):
    from studio_console.__main__ import main

    assert main(["--check", "--events", str(FIXTURES / "demo-events.jsonl")]) == 0
    out = capsys.readouterr().out
    assert "agents: " in out
    assert main(["--check", "--events", str(tmp_path / "missing.jsonl")]) == 1
