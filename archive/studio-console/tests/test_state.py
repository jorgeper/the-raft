"""State folding: active dispatches, loop progress, board, needs-you, summary."""

import json
from pathlib import Path

from studio_console.events import parse_line
from studio_console.state import ConsoleState

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "demo-events.jsonl"


def event(kind_name, item=None, agent=None, ts="2026-07-07T12:00:00+00:00", **data):
    return parse_line(json.dumps(
        {"v": 1, "seq": 1, "ts": ts, "kind": kind_name, "item": item, "agent": agent, "data": data}
    ))


def folded_fixture():
    state = ConsoleState()
    for line in FIXTURE.read_text().splitlines():
        state.apply(parse_line(line))
    return state


def test_dispatch_lifecycle_tracks_active():
    state = ConsoleState()
    state.apply(event("dispatch_start", item="1", agent="coder", shape="coder"))
    assert "1" in state.active
    assert state.active["1"].shape == "coder"
    state.apply(event("dispatch_end", item="1", agent="coder", action="dispatched"))
    assert state.active == {}


def test_loop_progress_folds_onto_active_dispatch():
    state = ConsoleState()
    state.apply(event("dispatch_start", item="1", agent="coder", shape="coder"))
    state.apply(event("loop_start", item="1", agent="coder",
                      tasks_total=5, tasks_passed=1, max_iterations=10, workdir="/w"))
    state.apply(event("iteration_start", item="1", agent="coder", n=2, task_id="t2"))
    state.apply(event("task_passed", item="1", agent="coder",
                      task_id="t2", tasks_passed=2, tasks_total=5))
    state.apply(event("guardrail_added", item="1", agent="coder", trigger="x"))
    loop = state.active["1"].loop
    assert (loop.tasks_passed, loop.tasks_total) == (2, 5)
    assert loop.iteration == 2 and loop.task_id == "t2"
    assert loop.guardrails == 1


def test_transitions_update_items_and_timeline():
    state = ConsoleState()
    state.apply(event("item_created", item="1", title="Add login", kind="bug", state="backlog"))
    state.apply(event("transition", item="1", **{"from": "backlog", "to": "design:drafting",
                                                 "actor": "human"}))
    view = state.items["1"]
    assert view.title == "Add login" and view.kind == "bug"
    assert view.state == "design:drafting"
    assert [e.kind for e in view.timeline] == ["item_created", "transition"]


def test_needs_you_and_board_ordering():
    state = ConsoleState()
    state.apply(event("item_created", item="1", title="a", kind="feature", state="backlog"))
    state.apply(event("item_created", item="2", title="b", kind="feature", state="prd:review"))
    state.apply(event("item_created", item="3", title="c", kind="feature", state="done"))
    assert [i.id for i in state.needs_you()] == ["2"]
    board = state.board()
    assert [s for s, _ in board] == ["backlog", "prd:review", "done"]


def test_snapshot_merges_without_losing_timeline():
    state = ConsoleState()
    state.apply(event("comment_added", item="1", author="prd", chars=5, comment_tail="hello"))
    state.apply_snapshot({"items": [{"id": "1", "title": "Real title", "state": "prd:review",
                                     "kind": "feature", "claimed_by": "", "updated": "t", "url": ""}]})
    view = state.items["1"]
    assert view.title == "Real title" and view.state == "prd:review"
    assert len(view.timeline) == 1  # folded history preserved


def test_fixture_folds_to_done_with_verified_loop():
    state = folded_fixture()
    assert state.healthy
    assert state.items["1"].state == "done"
    assert state.loop_exits.get("verified", 0) >= 1
    assert len(state.agents_seen) >= 3
    assert state.active == {}  # everything wound down


def test_summary_contains_greppable_lines():
    state = folded_fixture()
    summary = state.summary()
    assert "agents: " in summary and summary.count(",") >= 2
    assert "done=1" in summary
    # the demo's coder loop runs twice (initial + review-feedback round)
    assert "verified=" in summary and state.loop_exits["verified"] >= 1
    assert "events: " in summary


def test_version_warning_surfaces_in_summary():
    state = ConsoleState()
    state.apply(event("transition", item="1", **{"from": "a", "to": "b", "actor": "human"}))
    assert "WARNING" not in state.summary()
    bad = parse_line(json.dumps({"v": 99, "kind": "transition", "item": "1", "data": {}}))
    state.apply(bad)
    assert "version mismatch" in state.summary()


def test_agent_output_folds_into_active_buffer_and_last_stream():
    state = ConsoleState()
    state.apply(event("dispatch_start", item="1", agent="prd", shape="commenter"))
    state.apply(event("agent_output", item="1", agent="prd",
                      chunk="Reading the request… ", channel="text", done=False))
    state.apply(event("agent_output", item="1", agent="prd",
                      chunk="drafting.", channel="text", done=False))
    assert state.active["1"].output == "Reading the request… drafting."
    assert state.last_stream.text == "Reading the request… drafting."
    assert state.last_stream.live is True
    state.apply(event("agent_output", item="1", agent="prd", chunk="", channel="text", done=True))
    state.apply(event("dispatch_end", item="1", agent="prd", action="dispatched"))
    assert state.active == {}
    assert state.last_stream.live is False  # text survives for the live pane
    assert "drafting." in state.last_stream.text


def test_agent_output_buffer_is_capped():
    from studio_console.state import OUTPUT_BUFFER_CHARS

    state = ConsoleState()
    state.apply(event("dispatch_start", item="1", agent="coder", shape="coder"))
    for _ in range(10):
        state.apply(event("agent_output", item="1", agent="coder",
                          chunk="x" * 1000, channel="text", done=False))
    assert len(state.active["1"].output) == OUTPUT_BUFFER_CHARS
    assert len(state.last_stream.text) == OUTPUT_BUFFER_CHARS


def test_fixture_carries_streamed_output():
    state = folded_fixture()
    assert state.last_stream is not None
    assert state.last_stream.live is False
