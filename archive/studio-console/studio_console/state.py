"""Fold events + snapshots into one queryable model the UI renders from."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

from studio_console.events import Event

NEEDS_YOU = ("prd:review", "design:review", "pr:human-review", "needs-human")

PIPELINE_ORDER = [
    "backlog",
    "prd:drafting",
    "prd:review",
    "prd:approved",
    "design:drafting",
    "design:review",
    "design:approved",
    "ready",
    "coding",
    "pr:agent-review",
    "pr:changes-requested",
    "pr:human-review",
    "done",
    "needs-human",
]


@dataclass
class LoopProgress:
    tasks_total: int = 0
    tasks_passed: int = 0
    iteration: int = 0
    task_id: str | None = None
    workdir: str = ""
    max_iterations: int = 0
    guardrails: int = 0


@dataclass
class ActiveDispatch:
    item: str
    agent: str
    shape: str
    started_ts: str
    loop: LoopProgress | None = None


@dataclass
class ItemView:
    id: str
    title: str = ""
    state: str = "backlog"
    kind: str = "feature"
    claimed_by: str = ""
    updated: str = ""
    url: str = ""
    timeline: list[Event] = field(default_factory=list)


class ConsoleState:
    def __init__(self, feed_size: int = 500) -> None:
        self.items: dict[str, ItemView] = {}
        self.active: dict[str, ActiveDispatch] = {}  # keyed by item id
        self.feed: deque[Event] = deque(maxlen=feed_size)
        self.agents_seen: set[str] = set()
        self.loop_exits: dict[str, int] = {}  # reason -> count
        self.parse_errors: int = 0
        self.version_warning: bool = False
        self.events_applied: int = 0

    # ---------------------------------------------------------------- inputs

    def apply_snapshot(self, snapshot: dict) -> None:
        """Board truth from `studio status --json`; keeps folded timelines."""
        for raw in snapshot.get("items", []):
            view = self.items.setdefault(str(raw["id"]), ItemView(id=str(raw["id"])))
            view.title = raw.get("title", view.title)
            view.state = raw.get("state", view.state)
            view.kind = raw.get("kind", view.kind)
            view.claimed_by = raw.get("claimed_by", "")
            view.updated = raw.get("updated", "")
            view.url = raw.get("url", "")

    def apply(self, event: Event) -> None:
        self.events_applied += 1
        if not event.version_ok:
            self.version_warning = True
        if event.agent:
            self.agents_seen.add(event.agent)
        self.feed.appendleft(event)

        item = self.items.setdefault(event.item, ItemView(id=event.item)) if event.item else None
        if item is not None and event.kind in (
            "item_created", "transition", "comment_added", "loop_exit", "guardrail_added",
        ):
            item.timeline.append(event)

        handler = getattr(self, f"_on_{event.kind}", None)
        if handler:
            handler(event, item)

    # ---------------------------------------------------------------- folds

    def _on_item_created(self, e: Event, item: ItemView) -> None:
        item.title = e.data.get("title", item.title)
        item.kind = e.data.get("kind", item.kind)
        item.state = e.data.get("state", item.state)

    def _on_transition(self, e: Event, item: ItemView) -> None:
        item.state = e.data.get("to", item.state)
        item.updated = e.ts

    def _on_claimed(self, e: Event, item: ItemView) -> None:
        item.claimed_by = e.data.get("agent", "")

    def _on_released(self, e: Event, item: ItemView) -> None:
        item.claimed_by = ""

    def _on_dispatch_start(self, e: Event, item: ItemView | None) -> None:
        if e.item:
            self.active[e.item] = ActiveDispatch(
                item=e.item, agent=e.agent or "?", shape=e.data.get("shape", "?"), started_ts=e.ts
            )

    def _on_dispatch_end(self, e: Event, item: ItemView | None) -> None:
        if e.item:
            self.active.pop(e.item, None)

    def _on_loop_start(self, e: Event, item: ItemView | None) -> None:
        active = self.active.get(e.item or "")
        progress = LoopProgress(
            tasks_total=e.data.get("tasks_total", 0),
            tasks_passed=e.data.get("tasks_passed", 0),
            workdir=e.data.get("workdir", ""),
            max_iterations=e.data.get("max_iterations", 0),
        )
        if active:
            active.loop = progress

    def _loop(self, e: Event) -> LoopProgress | None:
        active = self.active.get(e.item or "")
        return active.loop if active else None

    def _on_iteration_start(self, e: Event, item: ItemView | None) -> None:
        if progress := self._loop(e):
            progress.iteration = e.data.get("n", progress.iteration)
            progress.task_id = e.data.get("task_id")

    def _on_task_passed(self, e: Event, item: ItemView | None) -> None:
        if progress := self._loop(e):
            progress.tasks_passed = e.data.get("tasks_passed", progress.tasks_passed)
            progress.tasks_total = e.data.get("tasks_total", progress.tasks_total)

    def _on_guardrail_added(self, e: Event, item: ItemView | None) -> None:
        if progress := self._loop(e):
            progress.guardrails += 1

    def _on_loop_exit(self, e: Event, item: ItemView | None) -> None:
        reason = e.data.get("reason", "?")
        self.loop_exits[reason] = self.loop_exits.get(reason, 0) + 1

    # ---------------------------------------------------------------- queries

    def counts_by_state(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for view in self.items.values():
            counts[view.state] = counts.get(view.state, 0) + 1
        return counts

    def needs_you(self) -> list[ItemView]:
        return [i for i in self.items.values() if i.state in NEEDS_YOU]

    def board(self) -> list[tuple[str, list[ItemView]]]:
        by_state: dict[str, list[ItemView]] = {}
        for view in self.items.values():
            by_state.setdefault(view.state, []).append(view)
        return [(s, sorted(by_state[s], key=lambda i: i.id)) for s in PIPELINE_ORDER if s in by_state]

    def summary(self) -> str:
        """The --check output. Stable-ish format: scripts grep these lines."""
        counts = self.counts_by_state()
        agents = ", ".join(sorted(self.agents_seen)) or "(none)"
        exits = ", ".join(f"{r}={n}" for r, n in sorted(self.loop_exits.items())) or "(none)"
        last = self.feed[0].one_line() if self.feed else "(no events)"
        states = ", ".join(f"{s}={n}" for s, n in sorted(counts.items())) or "(none)"
        lines = [
            "studio-console check",
            f"events: {self.events_applied} parsed, {self.parse_errors} errors",
            f"kinds: {len({e.kind for e in self.feed})} distinct in feed",
            f"agents: {agents}",
            f"items: {len(self.items)} ({states})",
            f"loop_exits: {exits}",
            f"active: {len(self.active)}",
            f"last: {last}",
        ]
        if self.version_warning:
            lines.append("WARNING: event schema version mismatch — update studio-console")
        return "\n".join(lines)

    @property
    def healthy(self) -> bool:
        return self.events_applied > 0 and self.parse_errors == 0
