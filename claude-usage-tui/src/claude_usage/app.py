"""The dashboard TUI: Overview / Sessions / History / Analytics tabs."""

from __future__ import annotations

import argparse
from collections import deque
from datetime import datetime, timedelta, timezone
from importlib.metadata import version
from pathlib import Path

from rich.table import Table
from rich.text import Text
from textual.app import App, ComposeResult
from textual.containers import VerticalScroll
from textual.widgets import Collapsible, Footer, Static

from claude_usage.aggregate import Totals, aggregate
from claude_usage.analytics import cache_hit_rate, sidechain_share, tool_counts
from claude_usage.burn import BurnRate, burn_rate, project_exhaustion
from claude_usage.format import GRUVBOX, bar, fmt_delta, fmt_tokens, limit_label
from claude_usage.history import daily_series, hour_heatmap, top_projects
from claude_usage.limits import Limit, fetch_limits
from claude_usage.pricing import context_window
from claude_usage.scanner import ScanState, scan_transcripts
from claude_usage.session_stats import SessionStats, session_stats
from claude_usage.sessions import count_claude_processes
from claude_usage.transcripts import Record

PROJECTS_ROOT = Path.home() / ".claude" / "projects"

SHADES = " ·░▒▓█"
BLOCKS = "▁▂▃▄▅▆▇█"


def fmt_duration(delta: timedelta) -> str:
    secs = int(delta.total_seconds())
    if secs < 60:
        return f"{secs}s"
    if secs < 3600:
        return f"{secs // 60}m"
    return f"{secs // 3600}h {(secs % 3600) // 60}m"


def short_model(model: str) -> str:
    return model.removeprefix("claude-") or "?"


def scale_char(value: float, max_value: float, chars: str) -> str:
    if max_value <= 0 or value <= 0:
        return chars[0]
    idx = min(len(chars) - 1, 1 + int((value / max_value) * (len(chars) - 2)))
    return chars[idx]


# ---------------------------------------------------------------- Overview


class LimitsPanel(Static):
    def show(
        self,
        limits: list[Limit] | None,
        error: str | None,
        projections: dict[str, datetime] | None = None,
        burn: BurnRate | None = None,
    ) -> str:
        table = Table.grid(padding=(0, 2))
        table.add_column(min_width=18)
        table.add_column()
        table.add_column(style="dim")
        for limit in limits or []:
            table.add_row(limit_label(limit.kind), bar(limit.percent), fmt_delta(limit.resets_at))
            eta = (projections or {}).get(limit.kind)
            if eta and limit.resets_at and eta < limit.resets_at:
                table.add_row(
                    "",
                    Text(
                        f"⚠ at this pace, hits 100% ~{eta.astimezone():%H:%M} "
                        f"(before the {limit.resets_at.astimezone():%H:%M} reset)",
                        style=GRUVBOX["yellow"],
                    ),
                    "",
                )
        if burn and burn.calls:
            table.add_row(
                "[dim]Burn (last hour)[/]",
                Text(
                    f"{fmt_tokens(round(burn.output_tokens_per_min))} out-tok/min · "
                    f"${burn.cost_per_hour:,.0f}/h API value · {burn.calls} calls",
                    style="dim",
                ),
                "",
            )
        self.update(table)
        return error or "live"


class StatsPanel(Static):
    def show(self, stats: dict[str, Totals] | None) -> str:
        if stats is None:
            self.update(Text("scanning transcripts…", style="dim italic"))
            return "scanning…"
        table = Table.grid(padding=(0, 2))
        table.add_column(min_width=18, style="bold")
        for _ in range(5):
            table.add_column(justify="right")
        table.add_row(
            "", "[dim]prompts[/]", "[dim]input[/]", "[dim]output[/]", "[dim]cache rd[/]",
            "[dim]API value*[/]",
        )
        for name, label in (("today", "Today"), ("7d", "Last 7 days"), ("30d", "Last 30 days")):
            t = stats[name]
            table.add_row(
                label,
                str(t.prompts),
                fmt_tokens(t.input_tokens + t.cache_write_tokens),
                fmt_tokens(t.output_tokens),
                fmt_tokens(t.cache_read_tokens),
                f"[bold {GRUVBOX['aqua']}]${t.cost_usd:,.2f}[/]",
            )
        by_model = sorted(
            ((m, t) for m, t in stats["30d"].by_model.items() if t.cost_usd >= 0.01),
            key=lambda kv: kv[1].cost_usd,
            reverse=True,
        )
        for model, t in by_model[:5]:
            table.add_row(
                f"[dim]  {model}[/]", "",
                f"[dim]{fmt_tokens(t.input_tokens + t.cache_write_tokens)}[/]",
                f"[dim]{fmt_tokens(t.output_tokens)}[/]",
                f"[dim]{fmt_tokens(t.cache_read_tokens)}[/]",
                f"[dim]${t.cost_usd:,.2f}[/]",
            )
        table.add_row(
            "[dim italic]*API list prices — you pay a flat subscription, not this[/]",
        )
        self.update(table)
        return f"${stats['today'].cost_usd:,.0f} today"


# ---------------------------------------------------------------- Sessions


class SessionsDetailPanel(Static):
    def show(self, stats: dict[Path, SessionStats] | None, process_count: int) -> str:
        if stats is None:
            self.update(Text("scanning transcripts…", style="dim italic"))
            return "scanning…"
        now = datetime.now(timezone.utc)
        recent = sorted(
            (s for s in stats.values() if now - s.last_ts < timedelta(hours=24)),
            key=lambda s: s.last_ts,
            reverse=True,
        )[:12]
        table = Table.grid(padding=(0, 1))
        headers = ["", "project", "model", "context", "", "dur", "prompts", "agents",
                   "last tool", "API value"]
        table.add_row(*[f"[dim]{h}[/]" for h in headers])
        home = str(Path.home())
        for s in recent:
            idle = (now - s.last_ts).total_seconds()
            live = idle < 300
            dot = f"[{GRUVBOX['green']}]●[/]" if live else "[dim]○[/]"
            name = (s.cwd or "?").replace(home, "~")
            if len(name) > 26:
                name = "…" + name[-25:]
            if s.git_branch:
                name += f" [dim]({s.git_branch})[/dim]"
            window = context_window(s.model)
            pct = 100 * s.context_tokens / window if window else 0
            table.add_row(
                dot,
                name,
                short_model(s.model),
                bar(pct, width=12),
                f"[dim]{fmt_tokens(s.context_tokens)}[/]",
                fmt_duration(s.duration),
                str(s.prompts),
                str(s.subagent_calls) if s.subagent_calls else "[dim]-[/]",
                s.last_tool or "[dim]-[/]",
                f"[{GRUVBOX['aqua']}]${s.cost_usd:,.2f}[/]",
            )
        if not recent:
            table.add_row(Text("no sessions in the last 24 hours", style="dim italic"))
        self.update(table)
        live = sum(1 for s in recent if (now - s.last_ts).total_seconds() < 300)
        return f"{live} live · {process_count} process(es)"


# ---------------------------------------------------------------- History


class HistoryPanel(Static):
    def show(self, records: list[Record] | None) -> None:
        if records is None:
            self.update(Text("scanning transcripts…", style="dim italic"))
            return
        now = datetime.now(timezone.utc)
        days = daily_series(records, now=now, days=30)
        max_cost = max((d.cost_usd for d in days), default=0)

        out = Text()
        out.append("Daily API value, last 30 days", style="bold")
        out.append(f"   (peak ${max_cost:,.0f})\n", style="dim")
        for d in days:
            out.append(scale_char(d.cost_usd, max_cost, BLOCKS), style=GRUVBOX["aqua"])
        out.append("\n")
        for i, d in enumerate(days):
            out.append("↑" if i == len(days) - 1 else ("·" if d.date.weekday() == 0 else " "),
                       style="dim")
        out.append(" today\n\n", style="dim")

        table = Table.grid(padding=(0, 2))
        table.add_column(min_width=12)
        for _ in range(3):
            table.add_column(justify="right")
        table.add_row("", "[dim]prompts[/]", "[dim]output[/]", "[dim]API value[/]")
        for d in days[-7:]:
            table.add_row(
                f"{d.date:%a %b %d}", str(d.prompts), fmt_tokens(d.output_tokens),
                f"${d.cost_usd:,.2f}",
            )

        grid = hour_heatmap(records, now=now, days=30)
        peak = max((v for row in grid for v in row), default=0)
        heat = Text("\nActivity by hour (last 30 days)\n", style="bold")
        heat.append("     " + "".join(f"{h:<6}" for h in range(0, 24, 3))[:48] + "\n",
                    style="dim")
        for wd, row in enumerate(grid):
            heat.append(f"{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][wd]}  ", style="dim")
            for v in row:
                heat.append(scale_char(v, peak, SHADES) * 2, style=GRUVBOX["yellow"])
            heat.append("\n")

        projects = Text("\nTop projects (30 days)\n", style="bold")
        for name, cost in top_projects(records):
            projects.append(f"  {name:<28}", style="")
            projects.append(f"${cost:,.2f}\n", style=GRUVBOX["aqua"])

        from rich.console import Group

        self.update(Group(out, table, heat, projects))


# ---------------------------------------------------------------- Analytics


class AnalyticsPanel(Static):
    def show(self, records: list[Record] | None) -> None:
        if records is None:
            self.update(Text("scanning transcripts…", style="dim italic"))
            return
        now = datetime.now(timezone.utc)
        recent = [r for r in records if now - r.timestamp < timedelta(days=30)]

        tools = tool_counts(recent).most_common(10)
        max_n = tools[0][1] if tools else 0
        out = Text("Tool calls (last 30 days)\n", style="bold")
        for name, n in tools:
            out.append(f"  {name:<14}", style="")
            out.append("█" * max(1, round(24 * n / max_n)) if max_n else "", style=GRUVBOX["green"])
            out.append(f" {n:,}\n", style="dim")

        hit = cache_hit_rate(recent)
        side, total = sidechain_share(recent)
        eff = Text("\nEfficiency (last 30 days)\n", style="bold")
        eff.append("  Cache hit rate     ")
        eff.append(f"{hit:6.1%}", style=f"bold {GRUVBOX['aqua']}")
        eff.append("  of input tokens read from cache at 0.1x price\n", style="dim")
        eff.append("  Subagent share     ")
        eff.append(f"{(side / total if total else 0):6.1%}", style=f"bold {GRUVBOX['aqua']}")
        eff.append(f"  ${side:,.2f} of ${total:,.2f} API value via subagents\n", style="dim")

        from rich.console import Group

        self.update(Group(out, eff))


# ---------------------------------------------------------------- App


SECTIONS = [
    ("limits", "Rate limits", False),
    ("stats", "Usage (all projects)", False),
    ("sessions", "Sessions (last 24h)", False),
    ("history", "History (30 days)", True),
    ("analytics", "Analytics (30 days)", True),
]


class UsageApp(App):
    TITLE = "Claude Usage"
    BINDINGS = [
        ("escape", "quit", "Quit"),
        ("q", "quit", "Quit"),
        ("r", "refresh", "Refresh"),
    ] + [
        (str(i + 1), f"toggle('{cid}')", title.split(" (")[0])
        for i, (cid, title, _) in enumerate(SECTIONS)
    ]
    CSS = """
    Screen { padding: 0 1; }
    Collapsible { border: none; background: $surface; margin-bottom: 1; }
    CollapsibleTitle { color: $accent; text-style: bold; }
    Contents > Static { padding: 0 2 1 2; height: auto; }
    """

    def compose(self) -> ComposeResult:
        panels = {
            "limits": LimitsPanel(),
            "stats": StatsPanel(),
            "sessions": SessionsDetailPanel(),
            "history": HistoryPanel(),
            "analytics": AnalyticsPanel(),
        }
        with VerticalScroll():
            for cid, title, collapsed in SECTIONS:
                with Collapsible(title=title, collapsed=collapsed, id=f"sec-{cid}"):
                    yield panels[cid]
        yield Footer()

    def on_mount(self) -> None:
        self.theme = "gruvbox"
        self._scan_state = ScanState()
        self._records: list[Record] = []
        self._limit_samples: dict[str, deque[tuple[datetime, float]]] = {}
        self.query_one(StatsPanel).show(None)
        self.refresh_limits()
        self.refresh_stats()
        self.set_interval(60, self.refresh_limits)
        self.set_interval(30, self.refresh_stats)

    def _stamp(self, cid: str, summary: str | None) -> None:
        base = next(title for c, title, _ in SECTIONS if c == cid)
        parts = [base] + ([summary] if summary else [])
        parts.append(f"updated {datetime.now().astimezone():%H:%M:%S}")
        self.query_one(f"#sec-{cid}", Collapsible).title = " · ".join(parts)

    def action_toggle(self, cid: str) -> None:
        section = self.query_one(f"#sec-{cid}", Collapsible)
        section.collapsed = not section.collapsed

    def action_refresh(self) -> None:
        self.refresh_limits()
        self.refresh_stats()

    def refresh_limits(self) -> None:
        self.run_worker(self._load_limits, thread=True, exclusive=True, group="limits")

    def refresh_stats(self) -> None:
        self.run_worker(self._load_stats, thread=True, exclusive=True, group="stats")

    def _show_and_stamp(self, cid: str, panel, *args) -> None:
        self._stamp(cid, panel.show(*args))

    def _load_limits(self) -> None:
        now = datetime.now(timezone.utc)
        try:
            limits = fetch_limits()
        except Exception as exc:  # degrade, never crash the panel
            self.call_from_thread(
                self._show_and_stamp, "limits", self.query_one(LimitsPanel),
                None, f"unavailable: {type(exc).__name__}",
            )
            return
        projections: dict[str, datetime] = {}
        for limit in limits:
            samples = self._limit_samples.setdefault(limit.kind, deque(maxlen=30))
            samples.append((now, limit.percent))
            eta = project_exhaustion(list(samples), now=now)
            if eta:
                projections[limit.kind] = eta
        burn = burn_rate(self._records, now=now)
        self.call_from_thread(
            self._show_and_stamp, "limits", self.query_one(LimitsPanel),
            limits, None, projections, burn,
        )

    def _load_stats(self) -> None:
        try:
            self._records.extend(scan_transcripts(PROJECTS_ROOT, self._scan_state))
            now = datetime.now(timezone.utc)
            stats = aggregate(self._records, now=now)
            per_session = session_stats(self._records)
            processes = count_claude_processes()
        except Exception:
            return
        records = self._records
        self.call_from_thread(self._show_and_stamp, "stats", self.query_one(StatsPanel), stats)
        self.call_from_thread(
            self._show_and_stamp, "sessions", self.query_one(SessionsDetailPanel),
            per_session, processes,
        )
        self.call_from_thread(self._show_and_stamp, "history", self.query_one(HistoryPanel), records)
        self.call_from_thread(
            self._show_and_stamp, "analytics", self.query_one(AnalyticsPanel), records
        )


def run_once() -> None:
    from claude_usage.snapshot import snapshot_text

    try:
        limits = fetch_limits()
    except Exception:
        limits = None
    records = scan_transcripts(PROJECTS_ROOT, ScanState())
    stats = aggregate(records, now=datetime.now(timezone.utc))
    print(snapshot_text(limits, stats), end="")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="claude-usage",
        description="Terminal dashboard for Claude Code usage: rate-limit meters, "
        "token/cost stats, per-session detail, history, analytics. With no "
        "arguments, opens the full-screen dashboard (Esc quits, r refreshes, "
        "1-5 toggle sections). Data auto-refreshes: stats every 30s, meters "
        "every 60s.",
    )
    parser.add_argument(
        "--once", action="store_true",
        help="print a one-shot snapshot to stdout and exit (no full-screen UI)",
    )
    parser.add_argument(
        "--version", action="version", version=f"%(prog)s {version('claude-usage-tui')}"
    )
    args = parser.parse_args()
    if args.once:
        run_once()
    else:
        UsageApp().run()


if __name__ == "__main__":
    main()
