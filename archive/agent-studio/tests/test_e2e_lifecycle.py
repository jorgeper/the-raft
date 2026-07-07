"""Full lifecycle e2e: backlog -> PRD -> design -> coding (real GoalLoop) ->
review (CHANGES then APPROVE) -> human review -> done. MarkdownTracker +
FakeRuntime; the only real subprocesses are git and the gate commands."""

import json
import subprocess

import pytest

from studio.agents.registry import AgentRegistry
from studio.config import AgentConfig, LoopConfig, RuntimeConfig, StudioConfig, TrackerConfig
from studio.orchestrator import Orchestrator
from studio.runtime.fake import FakeRuntime
from studio.state import Actor
from studio.tracker.markdown import MarkdownTracker


@pytest.fixture
def world(tmp_path):
    # -- the target app repo the coder will get a worktree of
    app = tmp_path / "app"
    app.mkdir()
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=app, check=True)
    subprocess.run(["git", "config", "user.email", "t@t"], cwd=app, check=True)
    subprocess.run(["git", "config", "user.name", "t"], cwd=app, check=True)
    (app / ".gitignore").write_text(".loop/\n")
    (app / "README.md").write_text("# app\n")
    subprocess.run(["git", "add", "-A"], cwd=app, check=True)
    subprocess.run(["git", "commit", "-qm", "seed"], cwd=app, check=True)

    # -- the studio scaffold
    root = tmp_path / "studio"
    (root / "prompts").mkdir(parents=True)
    for role in ("prd", "architect", "coder", "reviewer"):
        (root / "prompts" / f"{role}.md").write_text(f"# {role}\n")
    cfg = StudioConfig(
        root=root,
        tracker=TrackerConfig(kind="markdown"),
        runtimes={
            "claude": RuntimeConfig(name="claude", cmd="claude", kind="claude"),
            "codex": RuntimeConfig(name="codex", cmd="codex", kind="codex"),
        },
        agents={
            "prd": AgentConfig(name="prd", runtime="claude",
                               prompt=root / "prompts/prd.md", handles="prd:drafting"),
            "architect": AgentConfig(name="architect", runtime="claude",
                                     prompt=root / "prompts/architect.md", handles="design:drafting"),
            "coder": AgentConfig(name="coder", runtime="claude",
                                 prompt=root / "prompts/coder.md", handles="ready",
                                 loop=LoopConfig(max_iterations=5, max_minutes=5)),
            "reviewer-a": AgentConfig(name="reviewer-a", runtime="claude",
                                      prompt=root / "prompts/reviewer.md",
                                      handles="pr:agent-review", memory="reviewer"),
            "reviewer-b": AgentConfig(name="reviewer-b", runtime="codex",
                                      prompt=root / "prompts/reviewer.md",
                                      handles="pr:agent-review", memory="reviewer"),
        },
        target_repo=app,
    )
    tracker = MarkdownTracker(root / ".work")
    claude_rt, codex_rt = FakeRuntime(name="claude"), FakeRuntime(name="codex")
    orch = Orchestrator(cfg, tracker, AgentRegistry(cfg), {"claude": claude_rt, "codex": codex_rt})
    worktree = tmp_path / ".studio-worktrees" / "1"
    return cfg, tracker, claude_rt, codex_rt, orch, worktree


def commit_all(cwd, msg):
    subprocess.run(["git", "add", "-A"], cwd=cwd, check=True)
    subprocess.run(["git", "commit", "-qm", msg], cwd=cwd, check=False)


def test_full_lifecycle(world):
    cfg, tracker, claude_rt, codex_rt, orch, worktree = world

    # ---- human files a feature request
    item = tracker.create("Add todo API", "CRUD todos over HTTP", "backlog")
    tracker.transition(item.id, "prd:drafting", Actor.HUMAN)

    # ---- tick: PRD agent drafts
    claude_rt.script("# PRD\nR1: POST /todos creates a todo.")
    orch.tick()
    assert tracker.get("1").state == "prd:review"
    assert tracker.get("1").comments[-1].author == "prd"

    # ---- human approves the PRD
    tracker.transition("1", "prd:approved", Actor.HUMAN)
    tracker.transition("1", "design:drafting", Actor.HUMAN)

    # ---- tick: architect designs
    claude_rt.script("# Design\nAcceptance: `test -f feature.txt`")
    orch.tick()
    assert tracker.get("1").state == "design:review"
    assert tracker.get("1").comments[-1].author == "architect"

    # ---- human approves the design
    tracker.transition("1", "design:approved", Actor.HUMAN)
    tracker.transition("1", "ready", Actor.HUMAN)

    # ---- tick: coder runs the real GoalLoop in a real worktree
    def plan_it(prompt):
        loop_dir = worktree / ".loop"
        loop_dir.mkdir(exist_ok=True)
        (loop_dir / "plan.json").write_text(json.dumps({
            "gates": [],
            "tasks": [{"id": "t1", "title": "create feature",
                       "acceptance_command": "test -f feature.txt", "priority": 1}],
        }))
        return "planned"

    def build_it(prompt):
        assert "[t1] create feature" in prompt
        (worktree / "feature.txt").write_text("v1\n")
        commit_all(worktree, "feat(1): t1 create feature")
        return "built\nEXIT_SIGNAL: COMPLETE"

    claude_rt.script(plan_it, build_it)
    orch.tick()
    assert tracker.get("1").state == "pr:agent-review"
    assert "verified" in tracker.get("1").comments[-1].body
    assert (worktree / ".loop" / "progress.md").read_text().count("### iter") >= 2

    # ---- tick: review round — reviewer-b requests changes
    claude_rt.script("solid work\n\nVERDICT: APPROVE")
    codex_rt.script("[BLOCKER] feature.txt lacks a newline policy\n\nVERDICT: CHANGES")
    orch.tick()
    item = tracker.get("1")
    assert item.state == "pr:changes-requested"
    assert any(c.author == "reviewer-b" and "BLOCKER" in c.body for c in item.comments)

    # ---- tick: coder addresses the review (loop resumes: plan already green)
    def fix_it(prompt):
        (worktree / "feature.txt").write_text("v2 — addressed blocker\n")
        commit_all(worktree, "fix(1): address reviewer-b blocker")
        return "addressed the blocker\nEXIT_SIGNAL: COMPLETE"

    claude_rt.script(fix_it)
    orch.tick()
    assert tracker.get("1").state == "pr:agent-review"

    # ---- tick: second review round — both approve
    claude_rt.script("VERDICT: APPROVE")
    codex_rt.script("blocker addressed\n\nVERDICT: APPROVE")
    orch.tick()
    assert tracker.get("1").state == "pr:human-review"

    # ---- human merges
    tracker.transition("1", "done", Actor.HUMAN)
    assert tracker.get("1").state == "done"

    # ---- artifacts: every dispatch persisted a run
    runs = sorted(p.name for p in (cfg.root / "runs").iterdir())
    assert len(runs) >= 6  # prd, architect, coder x2, reviewers x4 (some same-second merged)
    assert all((cfg.root / "runs" / r / "prompt.md").is_file() for r in runs)

    # ---- the review history reads like a conversation
    authors = [c.author for c in tracker.get("1").comments]
    assert authors.count("coder") == 2
    assert "reviewer-a" in authors and "reviewer-b" in authors

    # ---- board reflects the final state
    board = (cfg.root / ".work" / "board.md").read_text()
    assert "## done" in board and "Add todo API" in board
