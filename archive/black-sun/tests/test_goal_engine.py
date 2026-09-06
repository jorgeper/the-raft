"""Coder loop engines: `python` (the built-in GoalLoop) vs `goal` (one
invocation of Claude Code's NATIVE /goal command). Either way the harness owns
completion — with the native engine it runs loop.gates itself afterward."""

from dataclasses import replace

import pytest
import yaml
from test_orchestrator import make_cfg, make_world

from blacksun.config import ConfigError, LoopConfig, load_config

GOAL_STATEMENT = "# Coder goal statement\nImplement the design spec.\n"


def _goal_cfg(tmp_path, gates=("true",)):
    cfg = make_cfg(tmp_path)
    (cfg.root / "prompts" / "goal-coder.md").write_text(GOAL_STATEMENT)
    agents = dict(cfg.agents)
    agents["coder"] = replace(
        agents["coder"], loop=LoopConfig(max_iterations=3, max_minutes=5,
                                         engine="goal", gates=tuple(gates)),
    )
    return replace(cfg, agents=agents)


# --- config --------------------------------------------------------------------


def _raw_config(engine="goal", runtime="claude", gates=("make test",), with_template=True):
    return {
        "tracker": {"kind": "markdown"},
        "runtimes": {
            "claude": {"cmd": "claude"},
            "ghcp": {"cmd": "copilot", "kind": "copilot"},
        },
        "agents": {
            "coder": {
                "runtime": runtime, "prompt": "prompts/coder.md", "handles": "ready",
                "loop": {"engine": engine, "gates": list(gates)},
            },
        },
    }, with_template


def _load_raw(tmp_path, raw_and_template):
    raw, with_template = raw_and_template
    root = tmp_path / "root"
    (root / "config").mkdir(parents=True)
    (root / "prompts").mkdir()
    (root / "prompts" / "coder.md").write_text("# coder\n")
    if with_template:
        (root / "prompts" / "goal-coder.md").write_text(GOAL_STATEMENT)
    cfg_path = root / "config" / "blacksun.yaml"
    cfg_path.write_text(yaml.safe_dump(raw))
    return load_config(cfg_path)


def test_engine_defaults_to_python():
    assert LoopConfig().engine == "python"
    assert LoopConfig().gates == ()


def test_goal_engine_parses(tmp_path):
    cfg = _load_raw(tmp_path, _raw_config())
    assert cfg.agents["coder"].loop.engine == "goal"
    assert cfg.agents["coder"].loop.gates == ("make test",)


def test_unknown_engine_fails(tmp_path):
    with pytest.raises(ConfigError, match="loop.engine"):
        _load_raw(tmp_path, _raw_config(engine="turbo"))


def test_goal_engine_requires_claude_runtime(tmp_path):
    """Copilot/Codex have no native /goal — fail loudly, point at engine: python."""
    with pytest.raises(ConfigError, match="engine: python"):
        _load_raw(tmp_path, _raw_config(runtime="ghcp"))


def test_goal_engine_requires_gates(tmp_path):
    """Without gates the harness could not verify anything itself."""
    with pytest.raises(ConfigError, match="loop.gates"):
        _load_raw(tmp_path, _raw_config(gates=()))


def test_goal_engine_requires_statement_file(tmp_path):
    with pytest.raises(ConfigError, match="goal-coder.md"):
        _load_raw(tmp_path, _raw_config(with_template=False))


# --- dispatch ------------------------------------------------------------------


def test_native_goal_dispatch_verified(tmp_path):
    """Green gates under the HARNESS's own runs -> pr:agent-review."""
    cfg = _goal_cfg(tmp_path)
    _, tracker, claude_rt, _, orch, stub = make_world(
        tmp_path, cfg=cfg, responses=["implemented; gates green on my run"]
    )
    tracker.create("Add login", "body", "ready")
    dispatches = orch.tick()
    assert [d.action for d in dispatches] == ["dispatched"]
    item = tracker.get("1")
    assert item.state == "pr:agent-review"
    assert "native /goal" in item.comments[-1].body
    # the model was driven through Claude Code's native goal command
    assert claude_rt.prompts[0].startswith("/goal ")
    assert "Coder goal statement" in claude_rt.prompts[0]
    assert "`true` must exit 0" in claude_rt.prompts[0]
    # the python GoalLoop was NOT used
    assert stub.calls == []


def test_native_goal_failing_gate_escalates(tmp_path):
    """The harness reruns the gates; a red gate parks the item, not the model's word."""
    cfg = _goal_cfg(tmp_path, gates=("make test",))
    _, tracker, claude_rt, _, orch, _ = make_world(
        tmp_path, cfg=cfg, responses=["all done, trust me, everything passes"]
    )
    orch.executor.queue()  # worktree add: ok
    orch.executor.queue(stdout="2 failed", returncode=1)  # the gate: red
    tracker.create("Add login", "body", "ready")
    dispatches = orch.tick()
    assert [d.action for d in dispatches] == ["escalated"]
    item = tracker.get("1")
    assert item.state == "needs-human"
    assert "make test" in item.comments[-1].body


def test_native_goal_needs_human_escalates(tmp_path):
    cfg = _goal_cfg(tmp_path)
    _, tracker, _, _, orch, _ = make_world(
        tmp_path, cfg=cfg, responses=["NEEDS_HUMAN: the design contradicts itself"]
    )
    tracker.create("Add login", "body", "ready")
    orch.tick()
    item = tracker.get("1")
    assert item.state == "needs-human"
    assert "contradicts itself" in item.comments[-1].body


def test_python_engine_passes_config_gates_to_goal(tmp_path):
    """loop.gates become standing harness gates for the built-in GoalLoop too."""
    cfg = make_cfg(tmp_path)
    agents = dict(cfg.agents)
    agents["coder"] = replace(
        agents["coder"],
        loop=LoopConfig(max_iterations=3, max_minutes=5, gates=("ruff check .",)),
    )
    cfg = replace(cfg, agents=agents)
    _, tracker, _, _, orch, stub = make_world(tmp_path, cfg=cfg)
    tracker.create("Add login", "body", "ready")
    orch.tick()
    (_, _, goal), = stub.calls
    assert goal.gates == ("ruff check .",)
