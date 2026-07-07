"""Orchestrator: plain code, no LLM. Polls the tracker, matches state -> agent,
dispatches, applies transitions, persists runs. Humans are never automated —
items in human-gated states are skipped and surfaced by `studio status`.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from studio.agents.registry import AgentRegistry
from studio.config import AgentConfig, StudioConfig
from studio.execution import CommandExecutor
from studio.loop import Goal, GoalLoop, LoopResult
from studio.runs import RunStore
from studio.runtime.base import ModelRuntime
from studio.state import Actor
from studio.tracker.base import Tracker, WorkItem

# After an agent finishes drafting, its item moves here (agent-actor edges).
_COMMENTER_NEXT = {"prd:drafting": "prd:review", "design:drafting": "design:review"}

_VERDICT_RE = re.compile(r"VERDICT:\s*(APPROVE|CHANGES)")


@dataclass
class Dispatch:
    item_id: str
    agent: str
    action: str  # dispatched | would-dispatch | skipped | failed | escalated
    detail: str = ""


def slugify(text: str, limit: int = 30) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:limit].rstrip("-") or "item"


class Orchestrator:
    def __init__(
        self,
        cfg: StudioConfig,
        tracker: Tracker,
        registry: AgentRegistry,
        runtimes: dict[str, ModelRuntime],
        run_store: RunStore | None = None,
        executor: CommandExecutor | None = None,
        loop_factory=None,
        sleep=time.sleep,
    ) -> None:
        self.cfg = cfg
        self.tracker = tracker
        self.registry = registry
        self.runtimes = runtimes
        self.run_store = run_store or RunStore(cfg.root / "runs")
        self.executor = executor or CommandExecutor()
        self.loop_factory = loop_factory or self._default_loop_factory
        self.sleep = sleep
        self.by_state: dict[str, list[AgentConfig]] = {}
        for agent in cfg.agents.values():
            self.by_state.setdefault(agent.handles, []).append(agent)
            if agent.loop is not None:  # loop agents also pick up review feedback
                self.by_state.setdefault("pr:changes-requested", []).append(agent)

    # ------------------------------------------------------------------ ticks

    def tick(self, dry_run: bool = False) -> list[Dispatch]:
        # Snapshot first: an item that transitions mid-tick (coder -> review) must not
        # be dispatched again until the next tick.
        snapshot = [
            (item, state, agents)
            for state, agents in self.by_state.items()
            for item in self.tracker.list(state=state)
        ]
        dispatches: list[Dispatch] = []
        budget = self.cfg.max_concurrent_agents
        for item, state, agents in snapshot:
            if budget <= 0:
                break
            if not dry_run and self.tracker.get(item.id).state != state:
                continue  # moved earlier in this tick
            if state == "pr:agent-review":
                result = self._review_round(item, agents, dry_run)
            elif agents[0].loop is not None:
                result = self._dispatch_coder(item, agents[0], dry_run)
            else:
                result = self._dispatch_commenter(item, agents[0], dry_run)
            dispatches.extend(result)
            if any(d.action != "skipped" for d in result):
                budget -= 1
        self._log(dispatches)
        return dispatches

    def watch(self) -> None:
        while True:
            self.tick()
            self.sleep(self.cfg.poll_interval_s)

    # ------------------------------------------------------------ dispatchers

    def _runtime(self, agent: AgentConfig) -> ModelRuntime:
        return self.runtimes[agent.runtime]

    def _persist(self, item: WorkItem, agent: AgentConfig, prompt: str, output: str) -> None:
        run = self.run_store.new_run(item.id, agent.name)
        run.save("prompt.md", prompt)
        run.save("output.md", output)

    def _dispatch_commenter(
        self, item: WorkItem, agent: AgentConfig, dry_run: bool
    ) -> list[Dispatch]:
        """prd / architect: one fresh invocation -> ONE comment -> state advances."""
        if dry_run:
            return [Dispatch(item.id, agent.name, "would-dispatch", f"state={item.state}")]
        if not self.tracker.claim(item.id, agent.name):
            return [Dispatch(item.id, agent.name, "skipped", "claimed by someone else")]
        try:
            prompt = self.registry.build_prompt(agent, self.tracker.get(item.id))
            result = self._runtime(agent).run(
                prompt, cwd=self.cfg.root, agent=self.registry.invocation_agent(agent)
            )
            self._persist(item, agent, prompt, result.output)
            if not result.ok or not result.output.strip():
                return [Dispatch(item.id, agent.name, "failed", f"exit={result.exit_code}; will retry")]
            self.tracker.comment(item.id, result.output, author=agent.name)
            self.tracker.transition(item.id, _COMMENTER_NEXT[item.state], Actor.AGENT)
            return [Dispatch(item.id, agent.name, "dispatched", f"-> {_COMMENTER_NEXT[item.state]}")]
        finally:
            self.tracker.release(item.id, agent.name)

    def _default_loop_factory(self, agent: AgentConfig) -> GoalLoop:
        return GoalLoop(
            self._runtime(agent),
            executor=self.executor,
            agent=self.registry.invocation_agent(agent),
        )

    def _worktree(self, item: WorkItem) -> tuple[Path, str]:
        target = (self.cfg.root / self.cfg.target_repo).resolve()
        branch = f"agent/{item.id}-{slugify(item.title)}"
        path = target.parent / ".studio-worktrees" / item.id
        if not path.exists():
            result = self.executor.run(
                ["git", "-C", str(target), "worktree", "add", str(path), "-b", branch]
            )
            if not result.ok:  # branch may exist from a previous attempt — reuse it
                self.executor.run(
                    ["git", "-C", str(target), "worktree", "add", str(path), branch]
                )
        return path, branch

    def _dispatch_coder(self, item: WorkItem, agent: AgentConfig, dry_run: bool) -> list[Dispatch]:
        if dry_run:
            return [Dispatch(item.id, agent.name, "would-dispatch", "GoalLoop in worktree")]
        if not self.tracker.claim(item.id, agent.name):
            return [Dispatch(item.id, agent.name, "skipped", "claimed by someone else")]
        try:
            self.tracker.transition(item.id, "coding", Actor.ORCHESTRATOR)
            workdir, branch = self._worktree(item)
            prompt = self.registry.build_prompt(agent, self.tracker.get(item.id), branch=branch)
            loop = self.loop_factory(agent)
            goal = Goal(
                max_iterations=agent.loop.max_iterations, max_minutes=agent.loop.max_minutes
            )
            result: LoopResult = loop.run(prompt, workdir, goal)
            self._persist(item, agent, prompt, f"loop exit: {result.reason}\n{result.gate_report}")
            if result.reason == "verified":
                self.tracker.comment(
                    item.id,
                    f"GoalLoop verified in {result.iterations} iterations on `{branch}`.\n\n"
                    f"Gate report:\n```\n{result.gate_report or 'all green'}\n```",
                    author=agent.name,
                )
                self.tracker.transition(item.id, "pr:agent-review", Actor.AGENT)
                return [Dispatch(item.id, agent.name, "dispatched", "verified -> pr:agent-review")]
            self.tracker.comment(
                item.id,
                f"GoalLoop stopped: **{result.reason}** after {result.iterations} iterations.\n\n"
                f"{result.gate_report}\n\nLast feedback:\n```\n{result.last_feedback}\n```",
                author=agent.name,
            )
            self.tracker.transition(item.id, "needs-human", Actor.ORCHESTRATOR)
            return [Dispatch(item.id, agent.name, "escalated", result.reason)]
        finally:
            self.tracker.release(item.id, agent.name)

    def _review_round(
        self, item: WorkItem, reviewers: list[AgentConfig], dry_run: bool
    ) -> list[Dispatch]:
        if dry_run:
            names = ", ".join(a.name for a in reviewers)
            return [Dispatch(item.id, names, "would-dispatch", "review round")]
        if not self.tracker.claim(item.id, "review-round"):
            return [Dispatch(item.id, "review-round", "skipped", "claimed by someone else")]
        try:
            available = [a for a in reviewers if self._runtime(a).available()]
            degraded = len(available) < min(len(reviewers), self.cfg.approvals_required)
            if not available or (degraded and not self.cfg.allow_degraded_review):
                return [
                    Dispatch(
                        item.id, "review-round", "skipped",
                        "not enough reviewer runtimes available "
                        f"({len(available)}/{self.cfg.approvals_required})",
                    )
                ]
            verdicts: list[tuple[str, str]] = []
            dispatches = []
            for agent in available:
                prompt = self.registry.build_prompt(agent, self.tracker.get(item.id))
                result = self._runtime(agent).run(
                    prompt, cwd=self.cfg.root, agent=self.registry.invocation_agent(agent)
                )
                self._persist(item, agent, prompt, result.output)
                matches = _VERDICT_RE.findall(result.output)
                verdict = matches[-1] if (result.ok and matches) else "CHANGES"
                verdicts.append((agent.name, verdict))
                self.tracker.comment(item.id, result.output or "(no output)", author=agent.name)
                dispatches.append(Dispatch(item.id, agent.name, "dispatched", f"verdict={verdict}"))
            if degraded:
                self.tracker.comment(
                    item.id,
                    f"note: degraded review — only {len(available)} of "
                    f"{self.cfg.approvals_required} required reviewers available.",
                    author="orchestrator",
                )
            if all(v == "APPROVE" for _, v in verdicts):
                self.tracker.transition(item.id, "pr:human-review", Actor.ORCHESTRATOR)
                dispatches.append(Dispatch(item.id, "review-round", "dispatched", "-> pr:human-review"))
            else:
                self.tracker.transition(item.id, "pr:changes-requested", Actor.ORCHESTRATOR)
                dispatches.append(
                    Dispatch(item.id, "review-round", "dispatched", "-> pr:changes-requested")
                )
            return dispatches
        finally:
            self.tracker.release(item.id, "review-round")

    # ---------------------------------------------------------------- logging

    def _log(self, dispatches: list[Dispatch]) -> None:
        log_dir = self.cfg.root / ".agent-logs"
        log_dir.mkdir(exist_ok=True)
        stamp = datetime.now(UTC).isoformat(timespec="seconds")
        summary = (
            "; ".join(f"#{d.item_id} {d.agent}: {d.action} {d.detail}".strip() for d in dispatches)
            or "idle"
        )
        with (log_dir / "orchestrator.log").open("a") as fh:
            fh.write(f"{stamp} {summary}\n")
