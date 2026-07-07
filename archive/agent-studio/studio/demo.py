"""The offline demo: the full lifecycle on a throwaway repo, no API keys.

`python -m studio.demo` (or `make demo`). Exits 0 only if the item reaches done,
having passed through a pr:changes-requested review cycle on the way.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from studio.agents.registry import AgentRegistry
from studio.config import AgentConfig, LoopConfig, RuntimeConfig, StudioConfig, TrackerConfig
from studio.events import EventLog
from studio.orchestrator import Orchestrator
from studio.runtime.fake import FakeRuntime
from studio.state import Actor
from studio.tracker.markdown import MarkdownTracker


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=False, capture_output=True)


def _scaffold(base: Path) -> tuple[StudioConfig, MarkdownTracker, FakeRuntime, FakeRuntime]:
    app = base / "app"
    app.mkdir()
    _git(app, "init", "-q", "-b", "main")
    _git(app, "config", "user.email", "demo@studio")
    _git(app, "config", "user.name", "studio-demo")
    (app / ".gitignore").write_text(".loop/\n")
    (app / "README.md").write_text("# demo app\n")
    _git(app, "add", "-A")
    _git(app, "commit", "-qm", "seed")

    root = base / "studio"
    (root / "prompts").mkdir(parents=True)
    for role in ("prd", "architect", "coder", "reviewer"):
        (root / "prompts" / f"{role}.md").write_text(f"# {role} (demo)\n")
    # A real config file so snapshot commands (status/show --json) work in the
    # kept sandbox — part of the observability contract.
    (root / "config").mkdir()
    (root / "config" / "studio.yaml").write_text(
        "tracker: {kind: markdown, root: .work}\n"
        "runtimes:\n"
        "  claude: {cmd: claude}\n"
        "  codex: {cmd: codex}\n"
        "agents:\n"
        "  prd: {runtime: claude, prompt: prompts/prd.md, handles: prd:drafting}\n"
        "  architect: {runtime: claude, prompt: prompts/architect.md, handles: design:drafting}\n"
        "  coder: {runtime: claude, prompt: prompts/coder.md, handles: ready,\n"
        "          loop: {max_iterations: 5, max_minutes: 5}}\n"
        "  reviewer-a: {runtime: claude, prompt: prompts/reviewer.md, handles: pr:agent-review,\n"
        "               memory: reviewer}\n"
        "  reviewer-b: {runtime: codex, prompt: prompts/reviewer.md, handles: pr:agent-review,\n"
        "               memory: reviewer}\n"
    )
    cfg = StudioConfig(
        root=root,
        tracker=TrackerConfig(kind="markdown"),
        runtimes={
            "claude": RuntimeConfig(name="claude", cmd="claude", kind="claude", streaming=True),
            "codex": RuntimeConfig(name="codex", cmd="codex", kind="codex"),
        },
        agents={
            "prd": AgentConfig(name="prd", runtime="claude",
                               prompt=root / "prompts/prd.md", handles="prd:drafting"),
            "architect": AgentConfig(name="architect", runtime="claude",
                                     prompt=root / "prompts/architect.md",
                                     handles="design:drafting"),
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
    events = EventLog(root / ".agent-logs" / "events.jsonl")
    tracker = MarkdownTracker(root / ".work", events=events)
    return cfg, tracker, FakeRuntime(name="claude"), FakeRuntime(name="codex"), events


def _say(step: str, tracker: MarkdownTracker, item_id: str = "1") -> None:
    state = tracker.get(item_id).state
    print(f"\n== {step}")
    print(f"   item #{item_id} state: {state}")


def run_demo(base: Path | None = None) -> str:
    """Drive the lifecycle; returns the item's final state."""
    base = base or Path(tempfile.mkdtemp(prefix="studio-demo-"))
    base.mkdir(parents=True, exist_ok=True)
    cfg, tracker, claude_rt, codex_rt, events = _scaffold(base)
    orch = Orchestrator(cfg, tracker, AgentRegistry(cfg),
                        {"claude": claude_rt, "codex": codex_rt}, events=events)
    worktree = (cfg.root / cfg.target_repo).resolve().parent / ".studio-worktrees" / "1"

    print("Agent Studio demo — full lifecycle, offline, scripted agents")
    print(f"   sandbox: {base}")

    tracker.create("Add todo API", "CRUD todos over HTTP", "backlog")
    tracker.transition("1", "prd:drafting", Actor.HUMAN)
    _say("you file a feature request (studio new)", tracker)

    claude_rt.script((
        "# PRD\n\nR1: POST /todos creates a todo and returns its id.",
        ["Reading the request… ", "drafting requirements. ",
         "R1 covers create; keeping v1 minimal."],
    ))
    orch.tick()
    _say("tick: prd agent drafts the PRD", tracker)

    tracker.transition("1", "prd:approved", Actor.HUMAN)
    tracker.transition("1", "design:drafting", Actor.HUMAN)
    _say("you approve the PRD (studio approve)", tracker)

    claude_rt.script((
        "# Design\n\nAcceptance: `test -f feature.txt`",
        ["Grounding the design in the repo… ",
         "one acceptance criterion, machine-runnable."],
    ))
    orch.tick()
    _say("tick: architect writes the design spec", tracker)

    tracker.transition("1", "design:approved", Actor.HUMAN)
    tracker.transition("1", "ready", Actor.HUMAN)
    _say("you approve the design (studio approve)", tracker)

    def plan_it(prompt: str) -> str:
        (worktree / ".loop").mkdir(exist_ok=True)
        (worktree / ".loop" / "plan.json").write_text(json.dumps({
            "gates": [],
            "tasks": [{"id": "t1", "title": "create feature",
                       "acceptance_command": "test -f feature.txt", "priority": 1}],
        }))
        return "plan written"

    def build_it(prompt: str) -> str:
        (worktree / "feature.txt").write_text("v1\n")
        _git(worktree, "add", "-A")
        _git(worktree, "commit", "-qm", "feat(1): t1 create feature")
        return "implemented\nEXIT_SIGNAL: COMPLETE"

    claude_rt.script(plan_it, build_it)
    orch.tick()
    _say("tick: coder's GoalLoop plans, builds, and the HARNESS verifies the gates", tracker)

    claude_rt.script((
        "clean implementation\n\nVERDICT: APPROVE",
        ["Checked out the branch, ran the gates myself… ", "all green."],
    ))
    codex_rt.script("[BLOCKER] feature.txt: no trailing-newline policy\n\nVERDICT: CHANGES")
    orch.tick()
    _say("tick: review round — reviewer-b (codex) requests changes", tracker)

    def fix_it(prompt: str) -> str:
        (worktree / "feature.txt").write_text("v2 — blocker addressed\n")
        _git(worktree, "add", "-A")
        _git(worktree, "commit", "-qm", "fix(1): address reviewer blocker")
        return "blocker addressed\nEXIT_SIGNAL: COMPLETE"

    claude_rt.script(fix_it)
    orch.tick()
    _say("tick: coder addresses the review feedback", tracker)

    claude_rt.script("VERDICT: APPROVE")
    codex_rt.script("blocker fixed\n\nVERDICT: APPROVE")
    orch.tick()
    _say("tick: second review round — both reviewers approve", tracker)

    tracker.transition("1", "done", Actor.HUMAN)
    _say("you read the history and merge (studio approve)", tracker)

    final = tracker.get("1").state
    print("\nboard:")
    print((cfg.root / ".work" / "board.md").read_text())
    print(f"runs persisted: {len(list((cfg.root / 'runs').iterdir()))}")
    return final


def main() -> int:
    parser = argparse.ArgumentParser(prog="studio.demo")
    parser.add_argument("--keep", action="store_true",
                        help="keep the sandbox (events, runs, worktrees) for inspection")
    args = parser.parse_args()
    base = Path(tempfile.mkdtemp(prefix="studio-demo-"))
    final = run_demo(base)
    if final != "done":
        print(f"DEMO FAILED: item ended in {final!r}", file=sys.stderr)
        return 1
    print("demo complete: the item went request -> PRD -> design -> code -> "
          "review loop -> done, with you approving at every human gate.")
    if args.keep:
        print(f"kept sandbox: {base} (events: {base}/studio/.agent-logs/events.jsonl)")
    else:
        shutil.rmtree(base, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
