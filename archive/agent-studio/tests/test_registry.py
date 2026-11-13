"""AgentRegistry: skill delivery per runtime, native subagent generation."""

from pathlib import Path

from studio.agents.registry import AgentRegistry
from studio.config import AgentConfig, RuntimeConfig, StudioConfig, TrackerConfig
from studio.tracker.base import Comment, WorkItem


def make_cfg(tmp_path: Path) -> StudioConfig:
    root = tmp_path / "studio"
    (root / "prompts").mkdir(parents=True)
    (root / "prompts" / "reviewer.md").write_text("# reviewer role\nBe rigorous.\n")
    skill = root / ".claude" / "skills" / "code-review-rubric"
    skill.mkdir(parents=True)
    (skill / "SKILL.md").write_text(
        "---\nname: code-review-rubric\ndescription: rubric\n---\n\nEvidence first.\n"
    )
    journal = root / "memory" / "reviewer"
    journal.mkdir(parents=True)
    (journal / "journal.md").write_text("# reviewer journal\n- watch for sql injection\n")
    return StudioConfig(
        root=root,
        tracker=TrackerConfig(kind="markdown"),
        runtimes={
            "claude": RuntimeConfig(name="claude", cmd="claude", kind="claude"),
            "codex": RuntimeConfig(name="codex", cmd="codex", kind="codex"),
        },
        agents={
            "reviewer-a": AgentConfig(
                name="reviewer-a", runtime="claude", prompt=root / "prompts/reviewer.md",
                handles="pr:agent-review", skills=("code-review-rubric",), memory="reviewer",
            ),
            "reviewer-b": AgentConfig(
                name="reviewer-b", runtime="codex", prompt=root / "prompts/reviewer.md",
                handles="pr:agent-review", skills=("code-review-rubric",), memory="reviewer",
            ),
        },
    )


ITEM = WorkItem(
    id="7", title="Add login", body="the body", state="pr:agent-review",
    comments=[Comment(author="architect", body="the design spec")],
)


def test_claude_agent_gets_native_invocation_and_context_only_prompt(tmp_path):
    cfg = make_cfg(tmp_path)
    registry = AgentRegistry(cfg)
    agent = cfg.agents["reviewer-a"]
    assert registry.invocation_agent(agent) == "studio-reviewer-a"
    prompt = registry.build_prompt(agent, ITEM)
    assert "Work item #7" in prompt
    assert "the design spec" in prompt
    assert "watch for sql injection" in prompt  # memory tail
    assert "# reviewer role" not in prompt  # role prompt lives in the subagent file
    assert "Evidence first" not in prompt  # skills preloaded natively, not inlined


def test_codex_agent_gets_inlined_role_and_skills(tmp_path):
    cfg = make_cfg(tmp_path)
    registry = AgentRegistry(cfg)
    agent = cfg.agents["reviewer-b"]
    assert registry.invocation_agent(agent) is None
    prompt = registry.build_prompt(agent, ITEM)
    assert "# reviewer role" in prompt
    assert "## Skills" in prompt and "Evidence first" in prompt
    assert "Work item #7" in prompt
    # role prompt comes before the task context
    assert prompt.index("# reviewer role") < prompt.index("Work item #7")


def test_generate_subagent_files_only_for_claude(tmp_path):
    cfg = make_cfg(tmp_path)
    registry = AgentRegistry(cfg)
    written = registry.generate_subagent_files()
    names = {p.name for p in written}
    assert names == {"studio-reviewer-a.md"}
    content = written[0].read_text()
    assert content.startswith("---\n")
    assert "name: studio-reviewer-a" in content
    assert "skills:\n  - code-review-rubric" in content
    assert "# reviewer role" in content  # body = the role prompt


def test_missing_journal_is_tolerated(tmp_path):
    cfg = make_cfg(tmp_path)
    import shutil

    shutil.rmtree(cfg.root / "memory")
    prompt = AgentRegistry(cfg).build_prompt(cfg.agents["reviewer-a"], ITEM)
    assert "(no journal yet)" in prompt
