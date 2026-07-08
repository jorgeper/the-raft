"""Regression guard (self-improve-spec R23/R25): watching records are judged
against their baseline once enough post-apply items are done; a >20% worsening
files a git-generated revert proposal through the same human gate."""

import json
import subprocess

import pytest
from test_improve_apply import _reviewable_item, studio_repo

from studio.agents.registry import AgentRegistry
from studio.cli import main
from studio.config import load_config
from studio.execution import CommandExecutor
from studio.improve import ImprovementsLog, judge_outcome
from studio.metrics import ScorecardLog
from studio.orchestrator import Orchestrator
from studio.runtime.fake import FakeRuntime
from studio.tracker.markdown import MarkdownTracker

# --- the judgment function ----------------------------------------------------


@pytest.mark.parametrize(
    "direction, baseline, current, outcome",
    [
        ("decrease", 3.0, 2.0, "kept"),  # improved
        ("decrease", 3.0, 3.0, "kept"),  # flat
        ("decrease", 3.0, 3.3, "watching"),  # worse, but only 10%
        ("decrease", 3.0, 4.0, "revert"),  # worse by 33%
        ("increase", 0.5, 0.8, "kept"),
        ("increase", 0.5, 0.3, "revert"),  # dropped 40%
        ("increase", 0.5, 0.45, "watching"),  # dropped 10%
        ("decrease", None, 4.0, "watching"),  # no baseline -> undecidable
        ("decrease", 3.0, None, "watching"),
        ("decrease", 0.0, 0.5, "revert"),  # any rise from zero is a regression
    ],
)
def test_judge_outcome(direction, baseline, current, outcome):
    assert judge_outcome(direction, baseline, current) == outcome


# --- end to end through the orchestrator ---------------------------------------


def _coder_events(root, iteration_counts):
    lines = [
        json.dumps({"v": 1, "kind": "loop_exit", "item": str(300 + i), "agent": "coder",
                    "data": {"reason": "verified", "iterations": n}})
        for i, n in enumerate(iteration_counts)
    ]
    (root / ".agent-logs").mkdir(exist_ok=True)
    (root / ".agent-logs" / "events.jsonl").write_text("\n".join(lines) + "\n")


def _world(root, cfg_path):
    cfg = load_config(cfg_path)
    tracker = MarkdownTracker(root / ".work")
    orch = Orchestrator(
        cfg, tracker, AgentRegistry(cfg), {"claude": FakeRuntime(name="claude")},
        executor=CommandExecutor(),
    )
    return cfg, tracker, orch


def _applied_repo(tmp_path, post_iterations):
    """studio repo with one improvement applied at baseline 3.0, then events
    reflecting post-apply coder behavior, then one post-apply done snapshot."""
    root, cfg_path = studio_repo(tmp_path)
    _coder_events(root, [3])  # baseline: iterations_per_verified = 3.0
    tracker, item = _reviewable_item(root)
    assert main(["--config", str(cfg_path), "approve", item.id]) == 0
    _coder_events(root, [3, *post_iterations])
    ScorecardLog(root / "memory" / "scorecard.jsonl").append(
        "50", set_name="evolving", kind="feature", agents={}
    )
    return root, cfg_path


def test_regression_files_revert_proposal(tmp_path, capsys):
    """R23: >20% worse -> a revert item with the exact inverse diff, human-gated."""
    root, cfg_path = _applied_repo(tmp_path, post_iterations=[5])  # mean 4.0, +33%
    cfg, tracker, orch = _world(root, cfg_path)
    orch.tick()
    reverts = [i for i in tracker.list(kind="improvement") if i.state == "improve:review"]
    assert len(reverts) == 1
    revert = reverts[0]
    assert "REVERT" in revert.title
    assert "3.0" in revert.body and "4.0" in revert.body  # baseline vs current quoted
    proposal_comment = revert.comments[-1].body
    assert "```diff" in proposal_comment
    assert "-Run the standing gates before touching any file." in proposal_comment


def test_improvement_kept_when_metric_improves(tmp_path, capsys):
    root, cfg_path = _applied_repo(tmp_path, post_iterations=[1])  # mean 2.0, improved
    cfg, tracker, orch = _world(root, cfg_path)
    orch.tick()
    log = ImprovementsLog(root / "memory" / "improvements.jsonl")
    assert log.current_status("1") == "kept"
    assert [i for i in tracker.list(kind="improvement") if "REVERT" in i.title] == []


def test_small_worsening_keeps_watching(tmp_path, capsys):
    root, cfg_path = _applied_repo(tmp_path, post_iterations=[4])  # mean 3.5, +17%
    cfg, tracker, orch = _world(root, cfg_path)
    orch.tick()
    log = ImprovementsLog(root / "memory" / "improvements.jsonl")
    assert log.current_status("1") == "watching"


def test_too_few_post_apply_items_defers_judgment(tmp_path, capsys):
    """R23: judgment waits for >= improve_every post-apply snapshots."""
    root, cfg_path = studio_repo(tmp_path)
    _coder_events(root, [3])
    tracker_setup, item = _reviewable_item(root)
    assert main(["--config", str(cfg_path), "approve", item.id]) == 0
    _coder_events(root, [3, 9])  # terrible, but no post-apply done item yet
    cfg, tracker, orch = _world(root, cfg_path)
    orch.tick()
    assert ImprovementsLog(root / "memory" / "improvements.jsonl").current_status("1") == "watching"


def test_approved_revert_restores_and_marks_reverted(tmp_path, capsys):
    """R23/R25: approving the revert restores the file byte-for-byte; the
    original improvement's status becomes reverted."""
    root, cfg_path = _applied_repo(tmp_path, post_iterations=[5])
    cfg, tracker, orch = _world(root, cfg_path)
    orch.tick()
    revert = [i for i in tracker.list(kind="improvement") if i.state == "improve:review"][0]
    assert main(["--config", str(cfg_path), "approve", revert.id]) == 0
    assert (root / "prompts" / "evolving" / "coder.md").read_text() == "# Coder agent\n"
    orch.tick()  # the guard notices the applied revert
    log = ImprovementsLog(root / "memory" / "improvements.jsonl")
    assert log.current_status("1") == "reverted"


def test_rejected_revert_marks_original_kept(tmp_path, capsys):
    """A human rejecting the revert is a decision to keep the change."""
    root, cfg_path = _applied_repo(tmp_path, post_iterations=[5])
    cfg, tracker, orch = _world(root, cfg_path)
    orch.tick()
    revert = [i for i in tracker.list(kind="improvement") if i.state == "improve:review"][0]
    assert main(["--config", str(cfg_path), "reject", revert.id, "--reason", "acceptable"]) == 0
    orch.tick()
    log = ImprovementsLog(root / "memory" / "improvements.jsonl")
    assert log.current_status("1") == "kept"


def test_revert_diff_matches_git_revert(tmp_path, capsys):
    """R25: the harness revert diff produces the same tree as `git revert`."""
    root, cfg_path = _applied_repo(tmp_path, post_iterations=[5])
    cfg, tracker, orch = _world(root, cfg_path)
    orch.tick()
    revert = [i for i in tracker.list(kind="improvement") if i.state == "improve:review"][0]

    # tree A: git revert on a clone
    clone = tmp_path / "clone"
    subprocess.run(["git", "clone", "-q", str(root), str(clone)], check=True)
    sha = [e for e in ImprovementsLog(root / "memory" / "improvements.jsonl").entries()
           if e["event"] == "applied"][0]["sha"]
    subprocess.run(["git", "-C", str(clone), "config", "user.email", "t@t"], check=True)
    subprocess.run(["git", "-C", str(clone), "config", "user.name", "t"], check=True)
    subprocess.run(["git", "-C", str(clone), "revert", "--no-edit", sha],
                   check=True, capture_output=True)

    # tree B: approving the harness-generated revert proposal
    assert main(["--config", str(cfg_path), "approve", revert.id]) == 0

    ours = (root / "prompts" / "evolving" / "coder.md").read_bytes()
    theirs = (clone / "prompts" / "evolving" / "coder.md").read_bytes()
    assert ours == theirs
