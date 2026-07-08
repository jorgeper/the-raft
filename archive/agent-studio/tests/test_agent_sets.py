"""Agent sets (self-improve-spec R1–R3): active-set selection, error cases,
and backward compatibility with a bare `agents:` config."""

from pathlib import Path

import pytest
import yaml

from studio.config import ConfigError, load_config

CLASSIC_AGENTS = {
    "prd": {"runtime": "claude", "prompt": "prompts/prd.md", "handles": "prd:drafting"},
    "coder": {
        "runtime": "claude", "prompt": "prompts/coder.md", "handles": "ready",
        "loop": {"max_iterations": 3, "max_minutes": 5},
    },
}

EVOLVING_AGENTS = {
    "prd": {"runtime": "claude", "prompt": "prompts/evolving/prd.md", "handles": "prd:drafting"},
    "improver": {
        "runtime": "claude", "prompt": "prompts/evolving/improver.md",
        "handles": "design:drafting",
    },
}


def _scaffold(tmp_path: Path, raw: dict) -> Path:
    """Write a config plus every prompt file any set references; return config path."""
    root = tmp_path / "studio-root"
    (root / "config").mkdir(parents=True)
    agent_groups = [raw.get("agents") or {}]
    for set_raw in (raw.get("agent_sets") or {}).values():
        agent_groups.append(set_raw.get("agents") or {})
    for agents in agent_groups:
        for agent in agents.values():
            prompt = root / agent["prompt"]
            prompt.parent.mkdir(parents=True, exist_ok=True)
            prompt.write_text("# prompt\n")
    cfg = root / "config" / "studio.yaml"
    cfg.write_text(yaml.safe_dump(raw))
    return cfg


def _base_raw(**extra) -> dict:
    raw = {
        "tracker": {"kind": "markdown"},
        "runtimes": {"claude": {"cmd": "claude"}},
    }
    raw.update(extra)
    return raw


def _sets_raw(active: str = "classic") -> dict:
    return _base_raw(
        active_set=active,
        agent_sets={
            "classic": {"agents": dict(CLASSIC_AGENTS)},
            "evolving": {"improve_every": 3, "agents": dict(EVOLVING_AGENTS)},
        },
    )


def test_active_set_selects_agents(tmp_path):
    """R1: only the active set's agents are exposed as cfg.agents."""
    cfg = load_config(_scaffold(tmp_path, _sets_raw("classic")))
    assert set(cfg.agents) == {"prd", "coder"}
    assert cfg.active_set == "classic"


def test_switching_active_set_switches_agents(tmp_path):
    """R1: flipping active_set exposes the other set, including its improve_every."""
    cfg = load_config(_scaffold(tmp_path, _sets_raw("evolving")))
    assert set(cfg.agents) == {"prd", "improver"}
    assert cfg.active_set == "evolving"
    assert cfg.improve_every == 3
    assert cfg.agents["prd"].prompt.name == "prd.md"
    assert "evolving" in str(cfg.agents["prd"].prompt)


def test_bare_agents_config_still_loads(tmp_path):
    """R2: a config with bare `agents:` and no `agent_sets:` loads as today."""
    cfg = load_config(_scaffold(tmp_path, _base_raw(agents=dict(CLASSIC_AGENTS))))
    assert set(cfg.agents) == {"prd", "coder"}
    assert cfg.active_set == "default"
    assert cfg.improve_every == 5


def test_unknown_active_set_fails(tmp_path):
    """R3: active_set naming an undefined set raises, listing the valid names."""
    raw = _sets_raw("classic")
    raw["active_set"] = "turbo"
    with pytest.raises(ConfigError, match=r"active_set.*'turbo'.*classic.*evolving"):
        load_config(_scaffold(tmp_path, raw))


def test_agent_sets_without_active_set_fails(tmp_path):
    """R3: agent_sets present but no active_set raises, listing the valid names."""
    raw = _sets_raw("classic")
    del raw["active_set"]
    with pytest.raises(ConfigError, match=r"active_set.*classic.*evolving"):
        load_config(_scaffold(tmp_path, raw))


def test_bare_agents_block_is_the_classic_set(tmp_path):
    """R4: a top-level agents: block coexists with agent_sets: as the implicit
    'classic' set, and active_set defaults to it — so the shipped config can
    define both sets without changing what the v1 format means."""
    raw = _base_raw(
        agents=dict(CLASSIC_AGENTS),
        agent_sets={"evolving": {"improve_every": 3, "agents": dict(EVOLVING_AGENTS)}},
    )
    cfg = load_config(_scaffold(tmp_path, raw))
    assert cfg.active_set == "classic"
    assert set(cfg.agents) == {"prd", "coder"}
    raw["active_set"] = "evolving"
    cfg = load_config(_scaffold(tmp_path / "b", raw))
    assert cfg.active_set == "evolving"
    assert set(cfg.agents) == {"prd", "improver"}
    assert cfg.improve_every == 3


def test_classic_cannot_be_defined_twice(tmp_path):
    raw = _base_raw(
        agents=dict(CLASSIC_AGENTS),
        agent_sets={"classic": {"agents": dict(CLASSIC_AGENTS)}},
    )
    with pytest.raises(ConfigError, match="already defines the 'classic' set"):
        load_config(_scaffold(tmp_path, raw))


def test_active_set_without_agent_sets_fails(tmp_path):
    """active_set on a bare-agents config is a mistake worth naming."""
    raw = _base_raw(agents=dict(CLASSIC_AGENTS), active_set="classic")
    with pytest.raises(ConfigError, match="active_set"):
        load_config(_scaffold(tmp_path, raw))


def test_broken_inactive_set_fails_on_switch(tmp_path):
    """Validation is per active set: a broken inactive set loads today and
    fails loudly at load time on the day you switch to it."""
    raw = _sets_raw("classic")
    cfg = _scaffold(tmp_path, raw)
    (cfg.parent.parent / "prompts" / "evolving" / "improver.md").unlink()
    load_config(cfg)  # classic active: fine
    raw["active_set"] = "evolving"
    cfg = _scaffold(tmp_path / "b", raw)
    (cfg.parent.parent / "prompts" / "evolving" / "improver.md").unlink()
    with pytest.raises(ConfigError, match="prompt: file not found"):
        load_config(cfg)


def test_improve_every_must_be_positive(tmp_path):
    """R17: improve_every must be >= 1."""
    raw = _sets_raw("evolving")
    raw["agent_sets"]["evolving"]["improve_every"] = 0
    with pytest.raises(ConfigError, match="improve_every"):
        load_config(_scaffold(tmp_path, raw))


def test_init_generates_subagents_for_active_set_only(tmp_path):
    """R5: `studio init` materializes native subagent files for the active set."""
    from studio.agents.registry import AgentRegistry

    cfg = load_config(_scaffold(tmp_path, _sets_raw("evolving")))
    written = AgentRegistry(cfg).generate_subagent_files()
    names = sorted(p.name for p in written)
    assert names == ["studio-improver.md", "studio-prd.md"]
    assert "coder" not in "".join(names)  # classic's coder is not generated
