"""Load and validate config/studio.yaml into typed config objects.

Validation fails loudly at load time with actionable messages — a bad config must
never make it into a running orchestrator.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

from studio.state import STATES


class ConfigError(Exception):
    """Raised for any invalid or missing configuration."""


@dataclass(frozen=True)
class TrackerConfig:
    kind: str  # "markdown" | "github"
    repo: str = ""  # github: owner/name
    root: str = ".work"  # markdown: state directory


@dataclass(frozen=True)
class RuntimeConfig:
    name: str
    cmd: str
    extra_flags: tuple[str, ...] = ()
    kind: str = ""  # "claude" | "codex"; defaults to the runtime's name


@dataclass(frozen=True)
class LoopConfig:
    max_iterations: int = 10
    max_minutes: int = 90


@dataclass(frozen=True)
class AgentConfig:
    name: str
    runtime: str
    prompt: Path
    handles: str
    skills: tuple[str, ...] = ()
    loop: LoopConfig | None = None
    memory: str = ""  # journal directory under memory/; defaults to the agent name
    mcp_servers: dict = field(default_factory=dict)
    hooks: dict = field(default_factory=dict)


@dataclass(frozen=True)
class StudioConfig:
    root: Path  # studio repo root (parent of config/, prompts/, .claude/)
    tracker: TrackerConfig
    runtimes: dict[str, RuntimeConfig]
    agents: dict[str, AgentConfig]
    approvals_required: int = 2
    allow_degraded_review: bool = True
    poll_interval_s: int = 60
    max_concurrent_agents: int = 2
    target_repo: Path = Path(".")

    def skill_dir(self, skill: str) -> Path:
        return self.root / ".claude" / "skills" / skill


def _require(cond: bool, msg: str) -> None:
    if not cond:
        raise ConfigError(msg)


def _load_tracker(raw: dict) -> TrackerConfig:
    _require(isinstance(raw, dict), "tracker: must be a mapping")
    kind = raw.get("kind")
    _require(kind in ("markdown", "github"), f"tracker.kind: {kind!r} is not 'markdown' or 'github'")
    if kind == "github":
        _require(bool(raw.get("repo")), "tracker.repo: required for the github tracker (owner/name)")
    return TrackerConfig(kind=kind, repo=raw.get("repo", ""), root=raw.get("root", ".work"))


def _load_agent(name: str, raw: dict, root: Path, runtimes: dict[str, RuntimeConfig]) -> AgentConfig:
    _require(isinstance(raw, dict), f"agents.{name}: must be a mapping")
    runtime = raw.get("runtime")
    _require(
        runtime in runtimes,
        f"agents.{name}.runtime: {runtime!r} is not a configured runtime "
        f"(have: {', '.join(sorted(runtimes)) or 'none'})",
    )
    prompt_rel = raw.get("prompt")
    _require(bool(prompt_rel), f"agents.{name}.prompt: required")
    prompt = root / prompt_rel
    _require(prompt.is_file(), f"agents.{name}.prompt: file not found: {prompt}")
    handles = raw.get("handles")
    _require(
        handles in STATES,
        f"agents.{name}.handles: unknown state {handles!r} (valid: {', '.join(sorted(STATES))})",
    )
    skills = tuple(raw.get("skills", []))
    for skill in skills:
        skill_md = root / ".claude" / "skills" / skill / "SKILL.md"
        _require(skill_md.is_file(), f"agents.{name}.skills: unknown skill {skill!r} ({skill_md} missing)")
    loop = None
    if "loop" in raw:
        loop_raw = raw["loop"]
        _require(isinstance(loop_raw, dict), f"agents.{name}.loop: must be a mapping")
        loop = LoopConfig(
            max_iterations=int(loop_raw.get("max_iterations", 10)),
            max_minutes=int(loop_raw.get("max_minutes", 90)),
        )
        _require(loop.max_iterations > 0, f"agents.{name}.loop.max_iterations: must be > 0")
        _require(loop.max_minutes > 0, f"agents.{name}.loop.max_minutes: must be > 0")
    return AgentConfig(
        name=name,
        runtime=runtime,
        prompt=prompt,
        handles=handles,
        skills=skills,
        loop=loop,
        memory=raw.get("memory", name),
        mcp_servers=raw.get("mcp_servers", {}),
        hooks=raw.get("hooks", {}),
    )


def load_config(path: Path | str) -> StudioConfig:
    path = Path(path)
    if not path.is_file():
        raise ConfigError(f"config file not found: {path}")
    try:
        raw = yaml.safe_load(path.read_text())
    except yaml.YAMLError as exc:
        raise ConfigError(f"{path}: invalid YAML: {exc}") from exc
    _require(isinstance(raw, dict), f"{path}: top level must be a mapping")

    root = path.resolve().parent.parent

    runtimes_raw = raw.get("runtimes")
    _require(isinstance(runtimes_raw, dict) and runtimes_raw, "runtimes: at least one runtime required")
    runtimes = {}
    for name, rt in runtimes_raw.items():
        _require(isinstance(rt, dict) and rt.get("cmd"), f"runtimes.{name}.cmd: required")
        kind = rt.get("kind", name)
        _require(
            kind in ("claude", "codex"),
            f"runtimes.{name}.kind: {kind!r} is not 'claude' or 'codex' "
            "(set kind explicitly when the runtime name is not one of those)",
        )
        runtimes[name] = RuntimeConfig(
            name=name, cmd=rt["cmd"], extra_flags=tuple(rt.get("extra_flags", [])), kind=kind
        )

    agents_raw = raw.get("agents")
    _require(isinstance(agents_raw, dict) and agents_raw, "agents: at least one agent required")
    agents = {name: _load_agent(name, a, root, runtimes) for name, a in agents_raw.items()}

    approvals = int(raw.get("approvals_required", 2))
    _require(approvals >= 1, "approvals_required: must be >= 1")
    poll = int(raw.get("poll_interval_s", 60))
    _require(poll >= 1, "poll_interval_s: must be >= 1")
    concurrent = int(raw.get("max_concurrent_agents", 2))
    _require(concurrent >= 1, "max_concurrent_agents: must be >= 1")

    return StudioConfig(
        root=root,
        tracker=_load_tracker(raw.get("tracker", {})),
        runtimes=runtimes,
        agents=agents,
        approvals_required=approvals,
        allow_degraded_review=bool(raw.get("allow_degraded_review", True)),
        poll_interval_s=poll,
        max_concurrent_agents=concurrent,
        target_repo=Path(raw.get("target_repo", ".")),
    )
