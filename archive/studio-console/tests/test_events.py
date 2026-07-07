"""Parser: every contract kind, forward compatibility, malformed input."""

import json
from pathlib import Path

import pytest

from studio_console.events import KNOWN_KINDS, Event, parse_line

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "demo-events.jsonl"


def test_fixture_parses_completely_and_covers_kinds():
    events = []
    for line in FIXTURE.read_text().splitlines():
        event = parse_line(line)
        assert event is not None
        events.append(event)
    assert len(events) >= 40
    kinds = {e.kind for e in events}
    assert kinds <= KNOWN_KINDS  # the fixture never contains unknown kinds
    assert len(kinds) >= 8
    assert all(e.version_ok for e in events)


def test_unknown_kind_is_tolerated():
    event = parse_line(json.dumps({"v": 1, "seq": 1, "ts": "t", "kind": "brand_new_thing",
                                   "item": None, "agent": None, "data": {"x": 1}}))
    assert event.kind == "brand_new_thing"
    assert not event.known
    assert event.one_line()  # renders without crashing


def test_version_mismatch_is_flagged_not_fatal():
    event = parse_line(json.dumps({"v": 2, "kind": "transition", "data": {}}))
    assert not event.version_ok


def test_blank_lines_return_none():
    assert parse_line("") is None
    assert parse_line("   \n") is None


def test_malformed_lines_raise_value_error():
    with pytest.raises(ValueError):
        parse_line("{not json")
    with pytest.raises(ValueError):
        parse_line('"just a string"')
    with pytest.raises(ValueError):
        parse_line('{"no_kind": true}')


def test_one_line_renderings():
    cases = {
        "transition": ({"from": "a", "to": "b", "actor": "human"}, "a → b"),
        "gate_result": ({"command": "pytest -q", "ok": True}, "ok $ pytest -q"),
        "gate_result_fail": ({"command": "x", "ok": False}, "FAIL"),
        "task_passed": ({"task_id": "t1", "tasks_passed": 2, "tasks_total": 5}, "t1 (2/5)"),
        "loop_exit": ({"reason": "verified", "iterations": 3}, "verified after 3"),
    }
    for kind, (data, expected) in cases.items():
        event = Event(v=1, seq=1, ts="2026-07-07T12:00:00+00:00",
                      kind=kind.replace("_fail", ""), item="1", agent="coder", data=data)
        assert expected in event.one_line()
