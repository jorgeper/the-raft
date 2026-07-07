"""Renderable builders: the display logic, tested without a terminal."""

import json
from pathlib import Path

from rich.console import Console

from studio_console.events import parse_line
from studio_console.state import ConsoleState
from studio_console.widgets import panels

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "demo-events.jsonl"


def event(kind_name, item=None, agent=None, ts="2026-07-07T12:00:00+00:00", **data):
    return parse_line(json.dumps(
        {"v": 1, "seq": 1, "ts": ts, "kind": kind_name, "item": item, "agent": agent, "data": data}
    ))


def render(renderable) -> str:
    console = Console(width=100, record=True)
    console.print(renderable)
    return console.export_text()


def folded():
    state = ConsoleState()
    for line in FIXTURE.read_text().splitlines():
        state.apply(parse_line(line))
    return state


def test_counts_line_flags_needs_you():
    state = ConsoleState()
    state.apply(event("item_created", item="1", title="a", kind="feature", state="pr:human-review"))
    line = panels.counts_line(state)
    assert "needs-you 1" in line


def test_active_table_shows_loop_progress():
    state = ConsoleState()
    state.apply(event("dispatch_start", item="4", agent="coder", shape="coder"))
    state.apply(event("loop_start", item="4", agent="coder",
                      tasks_total=5, tasks_passed=3, max_iterations=10))
    state.apply(event("iteration_start", item="4", agent="coder", n=3, task_id="t4"))
    text = render(panels.active_table(state))
    assert "coder" in text and "#4" in text
    assert "iter 3/10" in text and "3/5" in text
    assert "▮" in text


def test_active_table_idle():
    assert "idle" in render(panels.active_table(ConsoleState()))


def test_feed_row_shapes():
    row = panels.feed_row(event("gate_result", item="1", agent="coder",
                                command="pytest -q", ok=True))
    assert row[0] == "12:00:00"
    assert "gate_result" in row[1]
    assert "#1" in row[2] and "coder" in row[2]
    assert "pytest -q" in row[3]


def test_board_rows_pin_needs_you_first():
    state = ConsoleState()
    state.apply(event("item_created", item="1", title="a", kind="feature", state="backlog"))
    state.apply(event("item_created", item="2", title="b", kind="feature", state="needs-human"))
    rows = panels.board_rows(state)
    assert rows[0] == ("NEEDS YOU", None)
    assert rows[1][1].id == "2"


def test_item_markdown_replay_mode_reconstructs_comments():
    state = folded()
    view = state.items["1"]
    md = panels.item_markdown(view, snapshot=None)
    assert md.startswith("# #1")
    assert "## History" in md and "## Comments" in md
    assert "VERDICT" in md  # reviewer comment tails made it through


def test_item_markdown_prefers_snapshot():
    state = folded()
    snapshot = {"title": "Snapshot title", "body": "the body",
                "comments": [{"author": "prd", "body": "full PRD text"}]}
    md = panels.item_markdown(state.items["1"], snapshot)
    assert "Snapshot title" in md and "the body" in md and "full PRD text" in md


def test_event_detail_renders_tails_as_code_blocks():
    md = panels.event_detail(event("runtime_end", item="1", agent="prd",
                                   exit_code=0, duration_s=1.2, output_tail="agent said things"))
    assert "```text" in md and "agent said things" in md
    assert "**exit_code:** 0" in md
