"""Config loading and validation."""

from pathlib import Path

import pytest
import yaml

from studio.config import ConfigError, load_config

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_CONFIG = REPO_ROOT / "config" / "studio.yaml"


def _write_variant(tmp_path: Path, mutate) -> Path:
    """Copy the default config into a scaffold tmp tree, apply `mutate`, return path."""
    raw = yaml.safe_load(DEFAULT_CONFIG.read_text())
    mutate(raw)
    root = tmp_path / "studio-root"
    (root / "config").mkdir(parents=True)
    (root / "prompts").mkdir()
    for agent in raw.get("agents", {}).values():
        prompt = agent.get("prompt")
        if prompt:
            p = root / prompt
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("# prompt\n")
        for skill in agent.get("skills", []):
            d = root / ".claude" / "skills" / skill
            d.mkdir(parents=True, exist_ok=True)
            (d / "SKILL.md").write_text(f"---\nname: {skill}\ndescription: x\n---\n")
    cfg = root / "config" / "studio.yaml"
    cfg.write_text(yaml.safe_dump(raw))
    return cfg


def test_default_config_loads():
    cfg = load_config(DEFAULT_CONFIG)
    assert cfg.tracker.kind == "markdown"
    assert set(cfg.agents) == {"prd", "architect", "coder", "reviewer-a", "reviewer-b"}
    assert cfg.agents["coder"].loop is not None
    assert cfg.agents["coder"].loop.max_iterations == 10
    assert cfg.agents["reviewer-b"].runtime == "codex"
    assert cfg.approvals_required == 2


def test_missing_file_fails():
    with pytest.raises(ConfigError, match="not found"):
        load_config(Path("/nonexistent/studio.yaml"))


def test_unknown_state_fails(tmp_path):
    cfg = _write_variant(tmp_path, lambda raw: raw["agents"]["prd"].update(handles="prd:wat"))
    with pytest.raises(ConfigError, match="unknown state 'prd:wat'"):
        load_config(cfg)


def test_missing_prompt_file_fails(tmp_path):
    cfg = _write_variant(tmp_path, lambda raw: None)
    (cfg.parent.parent / "prompts" / "prd.md").unlink()
    with pytest.raises(ConfigError, match="prompt: file not found"):
        load_config(cfg)


def test_unknown_skill_fails(tmp_path):
    cfg = _write_variant(tmp_path, lambda raw: None)
    with pytest.raises(ConfigError, match="unknown skill"):
        import shutil

        shutil.rmtree(cfg.parent.parent / ".claude" / "skills" / "spec-writing")
        load_config(cfg)


def test_unknown_runtime_fails(tmp_path):
    cfg = _write_variant(tmp_path, lambda raw: raw["agents"]["prd"].update(runtime="gemini"))
    with pytest.raises(ConfigError, match="not a configured runtime"):
        load_config(cfg)


def test_bad_tracker_kind_fails(tmp_path):
    cfg = _write_variant(tmp_path, lambda raw: raw.update(tracker={"kind": "jira"}))
    with pytest.raises(ConfigError, match="tracker.kind"):
        load_config(cfg)


def test_github_tracker_requires_repo(tmp_path):
    cfg = _write_variant(tmp_path, lambda raw: raw.update(tracker={"kind": "github"}))
    with pytest.raises(ConfigError, match="tracker.repo"):
        load_config(cfg)


def test_approvals_must_be_positive(tmp_path):
    cfg = _write_variant(tmp_path, lambda raw: raw.update(approvals_required=0))
    with pytest.raises(ConfigError, match="approvals_required"):
        load_config(cfg)
