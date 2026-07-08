"""Scorecard metrics (self-improve-spec §4): computed by plain code from
events.jsonl, null (never 0) when there is no data, snapshotted per done item."""

import json
from pathlib import Path

from studio.metrics import ScorecardLog, compute_scorecard, read_events

FIXTURE = Path(__file__).parent / "fixtures" / "scorecard-events.jsonl"


def _ev(kind, item=None, agent=None, **data):
    return {"v": 1, "kind": kind, "item": item, "agent": agent, "data": data}


def _lifecycle_events():
    """Item 1: clean first-pass lifecycle with one changes-requested cycle.
    Item 2: coder escalates. Item 3: PRD needs a redraft, still undecided."""
    return [
        # -- item 1
        _ev("dispatch_end", "1", "prd", action="dispatched", detail="-> prd:review"),
        _ev("transition", "1", **{"from": "prd:review", "to": "prd:approved", "actor": "human"}),
        _ev("dispatch_end", "1", "architect", action="dispatched", detail="-> design:review"),
        _ev("transition", "1", **{"from": "design:review", "to": "design:approved", "actor": "human"}),
        _ev("loop_exit", "1", "coder", reason="verified", iterations=4),
        _ev("dispatch_end", "1", "coder", action="dispatched", detail="verified -> pr:agent-review"),
        # round 1: split verdicts
        _ev("dispatch_end", "1", "reviewer-a", action="dispatched", detail="verdict=APPROVE"),
        _ev("dispatch_end", "1", "reviewer-b", action="dispatched", detail="verdict=CHANGES"),
        _ev("dispatch_end", "1", "review-round", action="dispatched", detail="-> pr:changes-requested"),
        _ev("transition", "1", **{"from": "pr:agent-review", "to": "pr:changes-requested", "actor": "orchestrator"}),
        _ev("loop_exit", "1", "coder", reason="verified", iterations=2),
        _ev("dispatch_end", "1", "coder", action="dispatched", detail="verified -> pr:agent-review"),
        # round 2: unanimous
        _ev("dispatch_end", "1", "reviewer-a", action="dispatched", detail="verdict=APPROVE"),
        _ev("dispatch_end", "1", "reviewer-b", action="dispatched", detail="verdict=APPROVE"),
        _ev("dispatch_end", "1", "review-round", action="dispatched", detail="-> pr:human-review"),
        _ev("transition", "1", **{"from": "pr:agent-review", "to": "pr:human-review", "actor": "orchestrator"}),
        _ev("transition", "1", **{"from": "pr:human-review", "to": "done", "actor": "human"}),
        # -- item 2: the coder escalates
        _ev("loop_exit", "2", "coder", reason="budget-exhausted", iterations=10),
        _ev("dispatch_end", "2", "coder", action="escalated", detail="budget-exhausted"),
        # -- item 3: PRD bounced back once, no decision yet
        _ev("dispatch_end", "3", "prd", action="dispatched", detail="-> prd:review"),
        _ev("transition", "3", **{"from": "prd:review", "to": "prd:drafting", "actor": "human"}),
        _ev("dispatch_end", "3", "prd", action="dispatched", detail="-> prd:review"),
    ]


def test_coder_metrics():
    """R9: iterations averaged over verified exits only; escalations counted."""
    card = compute_scorecard(_lifecycle_events())
    coder = card["agents"]["coder"]
    assert coder["iterations_per_verified"] == 3.0  # (4 + 2) / 2, item 2 not verified
    assert coder["escalation_rate"] == 1 / 3  # 1 escalated of 3 dispatches
    assert coder["review_rounds_per_item"] == 0.5  # item 1 had 1 CR cycle, item 2 had 0


def test_reviewer_metrics():
    """R9: rounds until unanimous approve, and disagreement between the two."""
    card = compute_scorecard(_lifecycle_events())
    ra = card["agents"]["reviewer-a"]
    assert ra["rounds_until_approve"] == 2.0  # item 1 took two rounds
    assert ra["disagreement_rate"] == 0.5  # round 1 split, round 2 unanimous
    assert card["agents"]["reviewer-b"]["disagreement_rate"] == 0.5


def test_commenter_first_pass_rate():
    """R9: PRD first-pass rate counts only items with a decision; item 3 has none."""
    card = compute_scorecard(_lifecycle_events())
    assert card["agents"]["prd"]["first_pass_approval_rate"] == 1.0
    assert card["agents"]["architect"]["first_pass_approval_rate"] == 1.0


def test_no_data_is_null_not_zero():
    """R10: an agent with no relevant events reports null, never 0."""
    card = compute_scorecard([_ev("dispatch_end", "9", "coder", action="failed", detail="exit=1")])
    coder = card["agents"]["coder"]
    assert coder["iterations_per_verified"] is None
    assert card["agents"] == {"coder": coder}


def test_item_filter_restricts_scorecard():
    """R12: restricting to an item subset changes the aggregates."""
    card = compute_scorecard(_lifecycle_events(), items={"2"})
    coder = card["agents"]["coder"]
    assert coder["iterations_per_verified"] is None
    assert coder["escalation_rate"] == 1.0


def test_fixture_parses_and_scores():
    """The checked-in fixture (acceptance §11.4) yields a populated scorecard."""
    card = compute_scorecard(read_events(FIXTURE))
    assert "coder" in card["agents"]
    assert card["agents"]["coder"]["iterations_per_verified"] is not None


def test_read_events_skips_garbage(tmp_path):
    path = tmp_path / "events.jsonl"
    path.write_text('{"kind": "tick_start", "data": {}}\nnot json\n')
    events = read_events(path)
    assert len(events) == 1
    assert read_events(tmp_path / "missing.jsonl") == []


def test_scorecard_log_append_and_dedup(tmp_path):
    """R11: append-only snapshots keyed by item; recorded ids drive dedup."""
    log = ScorecardLog(tmp_path / "memory" / "scorecard.jsonl")
    assert log.recorded_ids() == set()
    log.append("1", set_name="evolving", kind="feature", agents={"coder": {"escalation_rate": 0.0}})
    log.append("2", set_name="evolving", kind="improvement", agents={})
    assert log.recorded_ids() == {"1", "2"}
    entries = log.entries()
    assert entries[0]["item"] == "1"
    assert entries[0]["set"] == "evolving"
    assert entries[1]["kind"] == "improvement"
    # append-only jsonl on disk
    lines = (tmp_path / "memory" / "scorecard.jsonl").read_text().splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["agents"]["coder"]["escalation_rate"] == 0.0


def test_orchestrator_snapshots_done_items(tmp_path):
    """R11: each done item gets exactly one snapshot line, appended by the tick."""
    from studio.agents.registry import AgentRegistry
    from studio.config import AgentConfig, RuntimeConfig, StudioConfig, TrackerConfig
    from studio.orchestrator import Orchestrator
    from studio.runtime.fake import FakeRuntime
    from studio.tracker.markdown import MarkdownTracker

    root = tmp_path / "studio"
    (root / "prompts").mkdir(parents=True)
    (root / "prompts" / "prd.md").write_text("# prd\n")
    cfg = StudioConfig(
        root=root,
        tracker=TrackerConfig(kind="markdown"),
        runtimes={"claude": RuntimeConfig(name="claude", cmd="claude", kind="claude")},
        agents={
            "prd": AgentConfig(
                name="prd", runtime="claude", prompt=root / "prompts" / "prd.md",
                handles="prd:drafting",
            )
        },
        active_set="evolving",
    )
    tracker = MarkdownTracker(root / ".work")
    tracker.create("shipped thing", "", "done", kind="feature")
    orch = Orchestrator(cfg, tracker, AgentRegistry(cfg), {"claude": FakeRuntime(name="claude")})
    orch.tick()
    log = ScorecardLog(root / "memory" / "scorecard.jsonl")
    entries = log.entries()
    assert [e["item"] for e in entries] == ["1"]
    assert entries[0]["set"] == "evolving"
    orch.tick()  # no duplicate on the next tick
    assert len(log.entries()) == 1


def test_scorecard_cli_json(capsys):
    """R10: `studio scorecard --json` emits a parseable object with .agents."""
    from studio.cli import main

    repo = Path(__file__).resolve().parent.parent
    rc = main([
        "--config", str(repo / "config" / "studio.yaml"),
        "scorecard", "--json", "--events", str(FIXTURE),
    ])
    assert rc == 0
    card = json.loads(capsys.readouterr().out)
    assert card["agents"]["coder"]["iterations_per_verified"] == 3.0


def test_scorecard_cli_human_and_empty(tmp_path, capsys):
    """Human view renders; a missing events file yields an empty-but-valid card."""
    from studio.cli import main

    repo = Path(__file__).resolve().parent.parent
    rc = main([
        "--config", str(repo / "config" / "studio.yaml"),
        "scorecard", "--events", str(tmp_path / "none.jsonl"),
    ])
    assert rc == 0
    assert "no events" in capsys.readouterr().out
