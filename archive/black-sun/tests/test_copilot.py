"""GitHub Copilot CLI runtime: headless `copilot -p`, skills inlined by the
registry (no native subagents), accepted by config validation."""

from pathlib import Path

import yaml

from blacksun.agents.registry import AgentRegistry
from blacksun.config import AgentConfig, RuntimeConfig, load_config
from blacksun.execution import CommandExecutor, FakeExecutor
from blacksun.runtime import CopilotRuntime, make_runtime
from blacksun.tracker.base import WorkItem


def _cfg(name="copilot", cmd="copilot", flags=("--allow-all-tools",)):
    return RuntimeConfig(name=name, cmd=cmd, extra_flags=tuple(flags), kind="copilot")


def test_factory_builds_copilot_runtime():
    runtime = make_runtime(_cfg())
    assert isinstance(runtime, CopilotRuntime)
    assert runtime.name == "copilot"


def test_argv_shape():
    runtime = CopilotRuntime(_cfg())
    assert runtime.build_argv("do the thing") == [
        "copilot", "-p", "do the thing", "--allow-all-tools",
    ]


def test_run_returns_output_and_appends_stderr_on_failure():
    executor = FakeExecutor()
    executor.queue(stdout="all done")
    runtime = CopilotRuntime(_cfg(), executor)
    result = runtime.run("task", cwd=Path("."))
    assert result.output == "all done"
    assert result.exit_code == 0

    executor.queue(stdout="partial", stderr="rate limited", returncode=1)
    result = runtime.run("task", cwd=Path("."))
    assert "partial" in result.output and "rate limited" in result.output
    assert result.exit_code == 1


def test_available_is_path_based():
    assert CopilotRuntime(_cfg(cmd="definitely-not-a-real-binary-xyz")).available() is False
    runtime = CopilotRuntime(_cfg(cmd="sh"), CommandExecutor())
    assert runtime.available() is True


def test_config_accepts_copilot_kind(tmp_path):
    root = tmp_path / "root"
    (root / "config").mkdir(parents=True)
    (root / "prompts").mkdir()
    (root / "prompts" / "prd.md").write_text("# prd\n")
    raw = {
        "tracker": {"kind": "markdown"},
        "runtimes": {"ghcp": {"cmd": "copilot", "kind": "copilot"}},
        "agents": {
            "prd": {"runtime": "ghcp", "prompt": "prompts/prd.md", "handles": "prd:drafting"},
        },
    }
    cfg_path = root / "config" / "blacksun.yaml"
    cfg_path.write_text(yaml.safe_dump(raw))
    cfg = load_config(cfg_path)
    assert cfg.runtimes["ghcp"].kind == "copilot"
    # streaming defaults off for non-claude runtimes
    assert cfg.runtimes["ghcp"].streaming is False


def test_registry_inlines_skills_for_copilot_agents(tmp_path):
    """Copilot has no native subagents: role prompt + SKILL.md bodies ride in
    the prompt, and no .claude/agents file is generated."""
    from blacksun.config import BlackSunConfig, TrackerConfig

    root = tmp_path / "root"
    (root / "prompts").mkdir(parents=True)
    (root / "prompts" / "reviewer.md").write_text("# reviewer role\n")
    skill = root / ".claude" / "skills" / "code-review-rubric"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text("---\nname: code-review-rubric\ndescription: x\n---\nrubric body\n")
    cfg = BlackSunConfig(
        root=root,
        tracker=TrackerConfig(kind="markdown"),
        runtimes={"ghcp": _cfg(name="ghcp")},
        agents={
            "reviewer-b": AgentConfig(
                name="reviewer-b", runtime="ghcp", prompt=root / "prompts" / "reviewer.md",
                handles="pr:agent-review", skills=("code-review-rubric",),
            )
        },
    )
    registry = AgentRegistry(cfg)
    agent = cfg.agents["reviewer-b"]
    assert registry.invocation_agent(agent) is None
    prompt = registry.build_prompt(agent, WorkItem(id="1", title="t", body="b", state="pr:agent-review"))
    assert "# reviewer role" in prompt
    assert "rubric body" in prompt
    assert registry.generate_subagent_files() == []
