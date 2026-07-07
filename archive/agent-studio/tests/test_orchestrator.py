"""Orchestrator: dispatch, claiming, verdict collection, degraded review."""

from pathlib import Path

from studio.agents.registry import AgentRegistry
from studio.config import AgentConfig, LoopConfig, RuntimeConfig, StudioConfig, TrackerConfig
from studio.execution import FakeExecutor
from studio.loop import LoopResult
from studio.orchestrator import Orchestrator, slugify
from studio.runtime.fake import FakeRuntime
from studio.tracker.markdown import MarkdownTracker


def make_cfg(tmp_path: Path, **overrides) -> StudioConfig:
    root = tmp_path / "studio"
    (root / "prompts").mkdir(parents=True)
    (root / "memory").mkdir()
    for role in ("prd", "architect", "coder", "reviewer"):
        (root / "prompts" / f"{role}.md").write_text(f"# {role} role prompt\n")
    kw = dict(
        root=root,
        tracker=TrackerConfig(kind="markdown"),
        runtimes={
            "claude": RuntimeConfig(name="claude", cmd="claude", kind="claude"),
            "codex": RuntimeConfig(name="codex", cmd="codex", kind="codex"),
        },
        agents={
            "prd": AgentConfig(
                name="prd", runtime="claude", prompt=root / "prompts/prd.md",
                handles="prd:drafting", memory="prd",
            ),
            "architect": AgentConfig(
                name="architect", runtime="claude", prompt=root / "prompts/architect.md",
                handles="design:drafting", memory="architect",
            ),
            "coder": AgentConfig(
                name="coder", runtime="claude", prompt=root / "prompts/coder.md",
                handles="ready", loop=LoopConfig(max_iterations=3, max_minutes=5), memory="coder",
            ),
            "reviewer-a": AgentConfig(
                name="reviewer-a", runtime="claude", prompt=root / "prompts/reviewer.md",
                handles="pr:agent-review", memory="reviewer",
            ),
            "reviewer-b": AgentConfig(
                name="reviewer-b", runtime="codex", prompt=root / "prompts/reviewer.md",
                handles="pr:agent-review", memory="reviewer",
            ),
        },
    )
    kw.update(overrides)
    return StudioConfig(**kw)


class StubLoop:
    def __init__(self, result: LoopResult):
        self.result = result
        self.calls = []

    def run(self, prompt, workdir, goal):
        self.calls.append((prompt, workdir, goal))
        return self.result


def make_world(tmp_path, cfg=None, responses=None, codex_available=True, loop_result=None):
    cfg = cfg or make_cfg(tmp_path)
    tracker = MarkdownTracker(cfg.root / ".work")
    claude_rt = FakeRuntime(responses or [], name="claude")
    codex_rt = FakeRuntime([], name="codex")
    if not codex_available:
        codex_rt.available = lambda: False  # type: ignore[method-assign]
    stub = StubLoop(loop_result or LoopResult(reason="verified", iterations=2))
    orch = Orchestrator(
        cfg,
        tracker,
        AgentRegistry(cfg),
        {"claude": claude_rt, "codex": codex_rt},
        executor=FakeExecutor(),
        loop_factory=lambda agent: stub,
    )
    return cfg, tracker, claude_rt, codex_rt, orch, stub


def test_prd_dispatch_comments_and_advances(tmp_path):
    cfg, tracker, claude_rt, _, orch, _ = make_world(tmp_path, responses=["# The PRD\ntext"])
    tracker.create("Add login", "we need auth", "prd:drafting")
    dispatches = orch.tick()
    assert [d.action for d in dispatches] == ["dispatched"]
    item = tracker.get("1")
    assert item.state == "prd:review"
    assert item.comments[-1].author == "prd"
    assert "# The PRD" in item.comments[-1].body
    assert item.claimed_by == ""  # released after the run
    # claude runtime invoked as the native subagent with task context only
    assert claude_rt.agents == ["studio-prd"]
    assert "Work item #1" in claude_rt.prompts[0]


def test_human_gated_states_are_skipped(tmp_path):
    cfg, tracker, _, _, orch, _ = make_world(tmp_path, responses=["should not run"])
    tracker.create("waiting on human", "", "prd:review")
    tracker.create("also waiting", "", "pr:human-review")
    assert orch.tick() == []


def test_failed_runtime_leaves_state_for_retry(tmp_path):
    cfg, tracker, claude_rt, _, orch, _ = make_world(tmp_path, responses=[""])  # empty output
    tracker.create("Add login", "", "prd:drafting")
    dispatches = orch.tick()
    assert dispatches[0].action == "failed"
    assert tracker.get("1").state == "prd:drafting"
    assert tracker.get("1").claimed_by == ""


def test_concurrency_budget_limits_dispatches(tmp_path):
    cfg = make_cfg(tmp_path, max_concurrent_agents=1)
    cfg, tracker, _, _, orch, _ = make_world(tmp_path, cfg=cfg, responses=["PRD one", "PRD two"])
    tracker.create("one", "", "prd:drafting")
    tracker.create("two", "", "prd:drafting")
    dispatched = [d for d in orch.tick() if d.action == "dispatched"]
    assert len(dispatched) == 1
    assert tracker.get("2").state == "prd:drafting"  # untouched until next tick


def test_claimed_item_is_skipped(tmp_path):
    cfg, tracker, _, _, orch, _ = make_world(tmp_path, responses=["PRD"])
    tracker.create("one", "", "prd:drafting")
    tracker.claim("1", "someone-else")
    assert [d.action for d in orch.tick()] == ["skipped"]


def test_dry_run_has_no_side_effects(tmp_path):
    cfg, tracker, claude_rt, _, orch, _ = make_world(tmp_path, responses=["PRD"])
    tracker.create("one", "", "prd:drafting")
    dispatches = orch.tick(dry_run=True)
    assert [d.action for d in dispatches] == ["would-dispatch"]
    assert tracker.get("1").state == "prd:drafting"
    assert claude_rt.prompts == []


def test_coder_verified_advances_to_agent_review(tmp_path):
    cfg, tracker, _, _, orch, stub = make_world(tmp_path)
    tracker.create("Build the API", "", "ready")
    dispatches = orch.tick()
    assert dispatches[0].action == "dispatched"
    item = tracker.get("1")
    assert item.state == "pr:agent-review"
    assert "verified" in item.comments[-1].body
    prompt, workdir, goal = stub.calls[0]
    assert goal.max_iterations == 3
    assert "agent/1-build-the-api" in prompt  # branch template variable


def test_coder_thrash_escalates_to_needs_human(tmp_path):
    cfg, tracker, _, _, orch, _ = make_world(
        tmp_path, loop_result=LoopResult(reason="thrash", iterations=5, gate_report="stuck")
    )
    tracker.create("Build the API", "", "ready")
    dispatches = orch.tick()
    assert dispatches[0].action == "escalated"
    item = tracker.get("1")
    assert item.state == "needs-human"
    assert "thrash" in item.comments[-1].body


def test_coder_picks_up_changes_requested(tmp_path):
    cfg, tracker, _, _, orch, stub = make_world(tmp_path)
    tracker.create("Build the API", "", "coding")
    tracker.transition("1", "pr:agent-review", __import__("studio.state", fromlist=["Actor"]).Actor.AGENT)
    tracker.transition("1", "pr:changes-requested", __import__("studio.state", fromlist=["Actor"]).Actor.ORCHESTRATOR)
    dispatches = orch.tick()
    assert dispatches[0].action == "dispatched"
    assert tracker.get("1").state == "pr:agent-review"


def test_review_round_both_approve_promotes(tmp_path):
    cfg, tracker, claude_rt, codex_rt, orch, _ = make_world(tmp_path)
    claude_rt.script("Looks solid.\n\nVERDICT: APPROVE")
    codex_rt.script("Independent pass.\n\nVERDICT: APPROVE")
    tracker.create("Build the API", "", "pr:agent-review")
    orch.tick()
    item = tracker.get("1")
    assert item.state == "pr:human-review"
    authors = [c.author for c in item.comments]
    assert "reviewer-a" in authors and "reviewer-b" in authors


def test_review_round_any_changes_requests_changes(tmp_path):
    cfg, tracker, claude_rt, codex_rt, orch, _ = make_world(tmp_path)
    claude_rt.script("VERDICT: APPROVE")
    codex_rt.script("[BLOCKER] injection risk\n\nVERDICT: CHANGES")
    tracker.create("Build the API", "", "pr:agent-review")
    orch.tick()
    assert tracker.get("1").state == "pr:changes-requested"


def test_review_round_missing_verdict_is_changes(tmp_path):
    cfg, tracker, claude_rt, codex_rt, orch, _ = make_world(tmp_path)
    claude_rt.script("VERDICT: APPROVE")
    codex_rt.script("I feel good about this")  # no machine-parseable verdict
    tracker.create("Build the API", "", "pr:agent-review")
    orch.tick()
    assert tracker.get("1").state == "pr:changes-requested"


def test_degraded_review_proceeds_with_note(tmp_path):
    cfg, tracker, claude_rt, _, orch, _ = make_world(tmp_path, codex_available=False)
    claude_rt.script("VERDICT: APPROVE")
    tracker.create("Build the API", "", "pr:agent-review")
    orch.tick()
    item = tracker.get("1")
    assert item.state == "pr:human-review"
    assert any("degraded review" in c.body for c in item.comments)


def test_degraded_review_blocked_when_disallowed(tmp_path):
    cfg = make_cfg(tmp_path, allow_degraded_review=False)
    cfg, tracker, claude_rt, _, orch, _ = make_world(tmp_path, cfg=cfg, codex_available=False)
    claude_rt.script("VERDICT: APPROVE")
    tracker.create("Build the API", "", "pr:agent-review")
    dispatches = orch.tick()
    assert dispatches[0].action == "skipped"
    assert tracker.get("1").state == "pr:agent-review"


def test_tick_appends_orchestrator_log(tmp_path):
    cfg, tracker, _, _, orch, _ = make_world(tmp_path)
    orch.tick()
    log = (cfg.root / ".agent-logs" / "orchestrator.log").read_text()
    assert "idle" in log


def test_slugify():
    assert slugify("Add OAuth2 login!") == "add-oauth2-login"
    assert slugify("???") == "item"


def test_runs_persisted(tmp_path):
    cfg, tracker, claude_rt, _, orch, _ = make_world(tmp_path, responses=["# PRD"])
    tracker.create("Add login", "", "prd:drafting")
    orch.tick()
    runs = list((cfg.root / "runs").glob("*-1-prd"))
    assert len(runs) == 1
    assert (runs[0] / "prompt.md").is_file()
    assert (runs[0] / "output.md").read_text() == "# PRD"
