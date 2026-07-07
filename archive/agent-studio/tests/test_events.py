"""Observability: envelope schema, tail caps, rotation, and emission at every
contract point (tracker, orchestrator, GoalLoop, demo). Spec: studio-console/spec.md
§3; doc: docs/architecture/07-observability.md."""

import json
import subprocess

import pytest

from studio.events import SCHEMA_VERSION, EventLog, NullEventLog
from studio.loop import EXIT_SIGNAL, Goal, GoalLoop
from studio.runtime.fake import FakeRuntime
from studio.state import Actor
from studio.tracker.markdown import MarkdownTracker


def read_events(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


# ------------------------------------------------------------------ envelope


def test_envelope_shape_and_seq(tmp_path):
    log = EventLog(tmp_path / "events.jsonl")
    log.emit("tick_start", n=1)
    log.emit("transition", item="3", **{"from": "backlog", "to": "prd:drafting", "actor": "human"})
    events = read_events(tmp_path / "events.jsonl")
    assert [e["seq"] for e in events] == [1, 2]
    for e in events:
        assert set(e) == {"v", "seq", "ts", "kind", "item", "agent", "data"}
        assert e["v"] == SCHEMA_VERSION
        assert "T" in e["ts"]
    assert events[1]["item"] == "3"
    assert events[1]["data"]["from"] == "backlog"


def test_seq_resumes_from_existing_file(tmp_path):
    path = tmp_path / "events.jsonl"
    EventLog(path).emit("tick_start", n=1)
    log2 = EventLog(path)  # a new writer picks up where the file left off
    log2.emit("tick_start", n=2)
    assert [e["seq"] for e in read_events(path)] == [1, 2]


def test_tails_are_capped(tmp_path):
    log = EventLog(tmp_path / "events.jsonl")
    log.emit("runtime_end", exit_code=0, output_tail="x" * 9000, gate_tail="y" * 9000)
    data = read_events(tmp_path / "events.jsonl")[0]["data"]
    assert len(data["output_tail"]) == 2000
    assert len(data["gate_tail"]) == 1000


def test_rotation(tmp_path):
    path = tmp_path / "events.jsonl"
    log = EventLog(path, max_bytes=200)
    for n in range(10):
        log.emit("tick_start", n=n)
    assert path.with_suffix(".jsonl.1").exists()
    assert path.stat().st_size < 500  # current file restarted


def test_null_log_is_silent_and_bindable(tmp_path):
    null = NullEventLog()
    null.bound(item="1", agent="coder").emit("anything", x=1)  # must not raise


def test_bound_log_injects_context(tmp_path):
    log = EventLog(tmp_path / "events.jsonl")
    bound = log.bound(item="7", agent="coder")
    bound.emit("loop_start", workdir="/w")
    bound.emit("transition", item="8")  # explicit wins
    events = read_events(tmp_path / "events.jsonl")
    assert (events[0]["item"], events[0]["agent"]) == ("7", "coder")
    assert events[1]["item"] == "8"


# ------------------------------------------------------------------ tracker


@pytest.fixture
def tracked(tmp_path):
    log = EventLog(tmp_path / "events.jsonl")
    return MarkdownTracker(tmp_path / ".work", events=log), tmp_path / "events.jsonl"


def test_tracker_emits_lifecycle(tracked):
    tracker, path = tracked
    tracker.create("Add login", "body", "backlog")
    tracker.transition("1", "prd:drafting", Actor.HUMAN)
    tracker.comment("1", "the PRD text", author="prd")
    tracker.claim("1", "coder")
    tracker.claim("1", "coder")  # idempotent re-claim: no second event
    tracker.release("1", "coder")
    kinds = [e["kind"] for e in read_events(path)]
    assert kinds == ["item_created", "transition", "comment_added", "claimed", "released"]
    events = read_events(path)
    assert events[0]["data"] == {"title": "Add login", "kind": "feature", "state": "backlog"}
    assert events[1]["data"] == {"from": "backlog", "to": "prd:drafting", "actor": "human"}
    assert events[2]["data"]["author"] == "prd"
    assert events[2]["data"]["comment_tail"] == "the PRD text"


# ------------------------------------------------------------------ GoalLoop


def _git_repo(tmp_path):
    repo = tmp_path / "app"
    repo.mkdir()
    for cmd in (["git", "init", "-q"], ["git", "config", "user.email", "t@t"],
                ["git", "config", "user.name", "t"]):
        subprocess.run(cmd, cwd=repo, check=True)
    (repo / ".gitignore").write_text(".loop/\n")
    subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-qm", "seed"], cwd=repo, check=True)
    return repo


def test_loop_emits_full_lifecycle(tmp_path):
    repo = _git_repo(tmp_path)
    log = EventLog(tmp_path / "events.jsonl")

    def solver(prompt):
        (repo / "hello.txt").write_text("done\n")
        subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
        subprocess.run(["git", "commit", "-qm", "solve"], cwd=repo, check=False)
        return EXIT_SIGNAL

    def planner(prompt):
        (repo / ".loop").mkdir(exist_ok=True)
        (repo / ".loop" / "plan.json").write_text(json.dumps({
            "gates": [], "tasks": [{"id": "t1", "title": "hello",
                                    "acceptance_command": "test -f hello.txt"}],
        }))
        return "planned"

    loop = GoalLoop(FakeRuntime([planner, solver]), events=log.bound(item="9", agent="coder"))
    result = loop.run("build", repo, Goal(max_iterations=4))
    assert result.reason == "verified"
    events = read_events(tmp_path / "events.jsonl")
    kinds = [e["kind"] for e in events]
    assert kinds[0] == "loop_start"
    assert "iteration_start" in kinds and "gate_result" in kinds
    assert "task_passed" in kinds and kinds[-1] == "loop_exit"
    assert all(e["item"] == "9" and e["agent"] == "coder" for e in events)
    exit_event = events[-1]["data"]
    assert exit_event["reason"] == "verified"
    gate = next(e for e in events if e["kind"] == "gate_result")
    assert gate["data"]["command"] == "test -f hello.txt" and gate["data"]["ok"] is True
    task = next(e for e in events if e["kind"] == "task_passed")
    assert task["data"] == {"task_id": "t1", "tasks_passed": 1, "tasks_total": 1}


def test_loop_emits_guardrail(tmp_path):
    repo = _git_repo(tmp_path)
    (repo / ".loop").mkdir()
    plan = {"gates": [], "tasks": [{"id": "t1", "acceptance_command": "test -f never.txt"}]}
    (repo / ".loop" / "plan.json").write_text(json.dumps(plan))
    (repo / ".loop" / "plan.canonical.json").write_text(json.dumps(plan))
    log = EventLog(tmp_path / "events.jsonl")

    def busy(prompt, _n=[0]):  # noqa: B006
        _n[0] += 1
        (repo / f"junk{_n[0]}").write_text("x")
        subprocess.run(["git", "add", "-A"], cwd=repo, check=True)
        subprocess.run(["git", "commit", "-qm", "junk"], cwd=repo, check=False)
        return "trying"

    GoalLoop(FakeRuntime([busy] * 6), events=log).run("build", repo, Goal(max_iterations=4))
    kinds = [e["kind"] for e in read_events(tmp_path / "events.jsonl")]
    assert "guardrail_added" in kinds


# ------------------------------------------------------------------ demo e2e


def test_demo_event_stream_is_coherent(tmp_path, capsys):
    from studio.demo import run_demo

    final = run_demo(tmp_path / "demo")
    assert final == "done"
    events = read_events(tmp_path / "demo" / "studio" / ".agent-logs" / "events.jsonl")
    kinds = [e["kind"] for e in events]
    assert kinds[0] == "item_created"
    # lifecycle order: created before any loop, loop verified before done
    assert kinds.index("loop_start") < kinds.index("loop_exit")
    loop_exits = [e for e in events if e["kind"] == "loop_exit"]
    assert any(e["data"]["reason"] == "verified" for e in loop_exits)
    transitions = [e["data"]["to"] for e in events if e["kind"] == "transition"]
    assert transitions[-1] == "done"
    assert "pr:changes-requested" in transitions  # the review loop looped
    assert len({e["kind"] for e in events}) >= 10
