"""Renderable builders. All display logic lives here as pure functions so the
Textual layer stays a thin shell (and the important rendering is unit-testable)."""

from __future__ import annotations

from datetime import UTC, datetime

from rich.table import Table
from rich.text import Text

from studio_console.events import Event
from studio_console.state import NEEDS_YOU, ConsoleState, ItemView

STATE_COLORS = {
    "prd:review": "red",
    "design:review": "red",
    "pr:human-review": "red",
    "needs-human": "bright_red",
    "coding": "blue",
    "pr:agent-review": "magenta",
    "pr:changes-requested": "magenta",
    "done": "green",
    "prd:approved": "green",
    "design:approved": "green",
    "ready": "green",
}

KIND_ICONS = {
    "tick_start": "·",
    "tick_end": "·",
    "dispatch_start": "▶",
    "dispatch_end": "■",
    "runtime_start": "⚙",
    "runtime_end": "⚙",
    "loop_start": "⟳",
    "iteration_start": "⟳",
    "gate_result": "✔",
    "task_passed": "★",
    "guardrail_added": "⚠",
    "loop_exit": "⏹",
    "item_created": "✚",
    "transition": "⇢",
    "comment_added": "✎",
    "claimed": "🔒",
    "released": "🔓",
}


def state_text(state: str) -> Text:
    return Text(state, style=STATE_COLORS.get(state, "white"))


def counts_line(state: ConsoleState) -> str:
    counts = state.counts_by_state()
    needs = sum(counts.get(s, 0) for s in NEEDS_YOU)
    parts = [f"{s.split(':')[-1]} {n}" for s, n in sorted(counts.items()) if s not in NEEDS_YOU]
    line = " · ".join(parts) if parts else "no items yet"
    if needs:
        line += f" · [bold red]needs-you {needs}[/]"
    if state.version_warning:
        line += "  [bold yellow]⚠ schema version mismatch[/]"
    return line


def elapsed(since_ts: str) -> str:
    try:
        delta = datetime.now(UTC) - datetime.fromisoformat(since_ts)
        seconds = max(0, int(delta.total_seconds()))
        return f"{seconds // 60:02d}:{seconds % 60:02d}"
    except ValueError:
        return "--:--"


def progress_bar(passed: int, total: int, width: int = 10) -> str:
    if total <= 0:
        return "…planning"
    filled = int(width * passed / total)
    return "▮" * filled + "▯" * (width - filled) + f" {passed}/{total}"


def active_table(state: ConsoleState) -> Table:
    table = Table(box=None, expand=True, padding=(0, 1), show_header=True)
    table.add_column("agent", style="bold cyan", no_wrap=True)
    table.add_column("item", no_wrap=True)
    table.add_column("shape", no_wrap=True)
    table.add_column("elapsed", no_wrap=True)
    table.add_column("progress")
    if not state.active:
        table.add_row(Text("idle", style="dim"), "", "", "", Text("waiting for dispatches…", style="dim"))
    for dispatch in state.active.values():
        progress = ""
        if dispatch.loop:
            loop = dispatch.loop
            progress = (
                f"iter {loop.iteration}/{loop.max_iterations}  "
                f"{progress_bar(loop.tasks_passed, loop.tasks_total)}"
            )
            if loop.guardrails:
                progress += f"  ⚠×{loop.guardrails}"
        table.add_row(
            f"▶ {dispatch.agent}", f"#{dispatch.item}", dispatch.shape,
            elapsed(dispatch.started_ts), progress,
        )
    return table


def feed_row(event: Event) -> tuple[str, str, str, str]:
    """(time, icon+kind, where, salient) — one DataTable row per event."""
    clock = event.ts.split("T")[1].split("+")[0] if "T" in event.ts else event.ts
    icon = KIND_ICONS.get(event.kind, "?")
    where = " ".join(p for p in (f"#{event.item}" if event.item else "", event.agent or "") if p)
    salient = event.one_line().split(event.kind, 1)[-1].strip()
    if event.item:
        salient = salient.replace(f"#{event.item}", "").strip()
    if event.agent and salient.startswith(event.agent):
        salient = salient[len(event.agent):].strip()
    return clock, f"{icon} {event.kind}", where, salient


def board_rows(state: ConsoleState) -> list[tuple[str, ItemView | None]]:
    """(section-or-"" , item) rows: a section header row then its items."""
    rows: list[tuple[str, ItemView | None]] = []
    needs = state.needs_you()
    if needs:
        rows.append(("NEEDS YOU", None))
        rows.extend(("", item) for item in needs)
    for section, items in state.board():
        rows.append((section, None))
        rows.extend(("", item) for item in items)
    return rows


def item_markdown(view: ItemView, snapshot: dict | None) -> str:
    """Item detail as Markdown. Prefers the full snapshot (live mode); falls back
    to folded timeline tails (replay mode)."""
    lines = [f"# #{view.id} {snapshot.get('title') if snapshot else view.title}", ""]
    lines.append(f"**state:** {view.state} · **kind:** {view.kind}"
                 + (f" · **claimed:** {view.claimed_by}" if view.claimed_by else ""))
    body = (snapshot or {}).get("body", "")
    if body:
        lines += ["", body]
    lines += ["", "## History", ""]
    for event in view.timeline:
        lines.append(f"- `{event.ts}` {event.one_line()}")
    comments = (snapshot or {}).get("comments")
    if comments is None:  # replay mode: reconstruct from event tails
        comments = [
            {"author": e.data.get("author", "?"), "body": e.data.get("comment_tail", "")}
            for e in view.timeline
            if e.kind == "comment_added"
        ]
    if comments:
        lines += ["", "## Comments", ""]
        for comment in comments:
            lines += [f"### {comment['author']}", "", comment["body"], ""]
    return "\n".join(lines)


def event_detail(event: Event) -> str:
    """Full single-event view (the feed's expand target), as Markdown."""
    lines = [f"# {event.kind}", "",
             f"`{event.ts}` · item: {event.item or '—'} · agent: {event.agent or '—'} "
             f"· seq {event.seq}", ""]
    for key, value in event.data.items():
        if key.endswith("_tail") and isinstance(value, str) and value:
            lines += [f"## {key}", "", "```text", value, "```", ""]
        else:
            lines.append(f"- **{key}:** {value}")
    return "\n".join(lines)
