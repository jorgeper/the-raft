"""AgentRegistry: turns declarative agent configs into runnable invocations.

Skill delivery is runtime-dependent (spec §3.3):
- claude: agents are materialized as native subagent files (.claude/agents/
  blacksun-<name>.md) with `skills:` preloading; invocation passes --agent and the
  prompt carries only the task context.
- anything else (codex): the role prompt and each SKILL.md body are inlined into
  the prompt — portable fallback, same knowledge.
"""

from __future__ import annotations

from pathlib import Path

from blacksun.config import AgentConfig, BlackSunConfig
from blacksun.tracker.base import WorkItem

MEMORY_TAIL_LINES = 50


class AgentRegistry:
    def __init__(self, cfg: BlackSunConfig) -> None:
        self.cfg = cfg

    # ------------------------------------------------------------ helpers

    def runtime_kind(self, agent: AgentConfig) -> str:
        rt = self.cfg.runtimes[agent.runtime]
        return rt.kind or rt.name

    def invocation_agent(self, agent: AgentConfig) -> str | None:
        """Native subagent name for runtimes that support one."""
        return f"blacksun-{agent.name}" if self.runtime_kind(agent) == "claude" else None

    def journal_path(self, agent: AgentConfig) -> Path:
        return self.cfg.root / "memory" / (agent.memory or agent.name) / "journal.md"

    def _memory_tail(self, agent: AgentConfig) -> str:
        journal = self.journal_path(agent)
        if not journal.is_file():
            return "(no journal yet)"
        return "\n".join(journal.read_text().splitlines()[-MEMORY_TAIL_LINES:])

    def _skill_bodies(self, agent: AgentConfig) -> str:
        parts = []
        for skill in agent.skills:
            body = (self.cfg.skill_dir(skill) / "SKILL.md").read_text()
            parts.append(f"### Skill: {skill}\n{body}")
        return "\n\n".join(parts)

    # ------------------------------------------------------------ prompts

    def task_context(self, agent: AgentConfig, item: WorkItem, branch: str = "") -> str:
        comments = "\n\n".join(f"**{c.author}:**\n{c.body}" for c in item.comments) or "(none)"
        return (
            f"## Work item #{item.id}: {item.title}\n"
            f"state: {item.state} | kind: {item.kind}\n\n"
            f"{item.body}\n\n"
            f"## Comments (oldest first)\n{comments}\n\n"
            f"## Your journal (tail)\n{self._memory_tail(agent)}\n\n"
            f"repo: {self.cfg.target_repo}" + (f" | branch: {branch}" if branch else "")
        )

    def build_prompt(self, agent: AgentConfig, item: WorkItem, branch: str = "") -> str:
        context = self.task_context(agent, item, branch)
        if self.invocation_agent(agent):
            # Role prompt + skills live in the generated native subagent file.
            return context
        role = agent.prompt.read_text()
        skills = self._skill_bodies(agent)
        skills_block = f"\n\n## Skills\n{skills}" if skills else ""
        return f"{role}{skills_block}\n\n{context}"

    def build_goal_prompt(self, agent: AgentConfig, item: WorkItem, branch: str) -> str:
        """loop.engine "goal": prefix the shipped statement with the native /goal
        command, list the gates the harness will rerun, then the task context."""
        statement = (self.cfg.root / "prompts" / "goal-coder.md").read_text()
        gates = "\n".join(f"- `{g}` must exit 0" for g in (agent.loop.gates if agent.loop else ()))
        context = self.task_context(agent, item, branch)
        return (
            f"/goal {statement}\n"
            "## Gates — the harness reruns every one of these itself after you stop; "
            f"all must exit 0\n{gates}\n\n{context}"
        )

    # ------------------------------------------- native subagent generation

    def subagent_file_content(self, agent: AgentConfig) -> str:
        skills = "".join(f"\n  - {s}" for s in agent.skills)
        skills_block = f"skills:{skills}\n" if agent.skills else ""
        extras = ""
        if agent.mcp_servers:
            servers = "".join(f"\n  - {k}" for k in agent.mcp_servers)
            extras += f"mcpServers:{servers}\n"
        return (
            "---\n"
            f"name: blacksun-{agent.name}\n"
            f"description: Black Sun {agent.name} agent (generated — edit prompts/"
            f"{agent.prompt.name} and rerun `blacksun init`)\n"
            f"{skills_block}{extras}"
            "---\n\n"
            f"{agent.prompt.read_text()}"
        )

    def generate_subagent_files(self) -> list[Path]:
        """Materialize .claude/agents/blacksun-<name>.md for claude-runtime agents."""
        out_dir = self.cfg.root / ".claude" / "agents"
        out_dir.mkdir(parents=True, exist_ok=True)
        written = []
        for agent in self.cfg.agents.values():
            if self.runtime_kind(agent) != "claude":
                continue
            path = out_dir / f"blacksun-{agent.name}.md"
            path.write_text(self.subagent_file_content(agent))
            written.append(path)
        return written
