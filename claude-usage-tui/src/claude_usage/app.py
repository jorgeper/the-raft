"""The dashboard TUI: rate-limit meters, usage stats, active sessions."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from rich.table import Table
from rich.text import Text
from textual.app import App, ComposeResult
from textual.containers import Vertical
from textual.widgets import Footer, Static

from claude_usage.aggregate import Totals, aggregate
from claude_usage.limits import Limit, fetch_limits
from claude_usage.scanner import ScanState, scan_transcripts
from claude_usage.sessions import count_claude_processes, recent_sessions
from claude_usage.transcripts import Record

PROJECTS_ROOT = Path.home() / ".claude" / "projects"

KIND_LABELS = {
    "session": "Session (5h)",
    "five_hour": "Session (5h)",
    "seven_day": "Week (all models)",
    "weekly_all": "Week (all models)",
    "weekly_scoped": "Week (Opus/Fable)",
    "seven_day_opus": "Week (Opus)",
    "seven_day_sonnet": "Week (Sonnet)",
}


def fmt_tokens(n: int) -> str:
    if n >= 1_000_000_000:
        return f"{n / 1e9:.1f}B"
    if n >= 1_000_000:
        return f"{n / 1e6:.1f}M"
    if n >= 1_000:
        return f"{n / 1e3:.1f}K"
    return str(n)


def fmt_delta(until: datetime | None) -> str:
    if until is None:
        return ""
    secs = (until - datetime.now(timezone.utc)).total_seconds()
    if secs <= 0:
        return "resetting…"
    hours, rem = divmod(int(secs), 3600)
    if hours >= 24:
        return f"resets in {hours // 24}d {hours % 24}h"
    return f"resets in {hours}h {rem // 60}m"


def bar(percent: float, width: int = 40) -> Text:
    percent = max(0.0, min(100.0, percent))
    filled = round(width * percent / 100)
    color = "green" if percent < 60 else "yellow" if percent < 85 else "red"
    text = Text()
    text.append("█" * filled, style=color)
    text.append("░" * (width - filled), style="grey37")
    text.append(f" {percent:3.0f}%", style=f"bold {color}")
    return text


class LimitsPanel(Static):
    def show(self, limits: list[Limit] | None, error: str | None) -> None:
        table = Table.grid(padding=(0, 2))
        table.add_column(min_width=18)
        table.add_column()
        table.add_column(style="dim")
        for limit in limits or []:
            label = KIND_LABELS.get(limit.kind, limit.kind.replace("_", " ").title())
            table.add_row(label, bar(limit.percent), fmt_delta(limit.resets_at))
        self.update(table)
        self.border_subtitle = f"[red]{error}[/]" if error else "live"


class StatsPanel(Static):
    def show(self, stats: dict[str, Totals] | None) -> None:
        if stats is None:
            self.update(Text("scanning transcripts…", style="dim italic"))
            return
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
                f"[bold cyan]${t.cost_usd:,.2f}[/]",
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
        self.update(table)
        self.border_subtitle = "*what this would cost at API list prices — you pay a flat subscription, not this"


class SessionsPanel(Static):
    def show(self, sessions, process_count: int) -> None:
        table = Table.grid(padding=(0, 2))
        table.add_column(min_width=40)
        table.add_column(style="dim")
        if not sessions:
            table.add_row(Text("no sessions active in the last 10 minutes", style="dim italic"))
        for s in sessions[:8]:
            home = str(Path.home())
            cwd = s.cwd.replace(home, "~") if s.cwd else s.path.parent.name
            idle = int(s.idle_seconds)
            when = "active now" if idle < 90 else f"{idle // 60}m ago"
            table.add_row(f"[green]●[/] {cwd}", when)
        self.update(table)
        self.border_subtitle = f"{process_count} claude process(es)"


class UsageApp(App):
    TITLE = "Claude Usage"
    BINDINGS = [("escape", "quit", "Quit"), ("q", "quit", "Quit"), ("r", "refresh", "Refresh")]
    CSS = """
    Screen { padding: 1 2; }
    Static { border: round $primary 40%; padding: 1 2; margin-bottom: 1; height: auto; }
    Static:light { border: round $primary 60%; }
    #limits { border-title-color: $accent; }
    """

    def compose(self) -> ComposeResult:
        with Vertical():
            yield LimitsPanel(id="limits")
            yield StatsPanel(id="stats")
            yield SessionsPanel(id="sessions")
        yield Footer()

    def on_mount(self) -> None:
        self.query_one(LimitsPanel).border_title = "Rate limits"
        self.query_one(StatsPanel).border_title = "Usage (all projects)"
        self.query_one(SessionsPanel).border_title = "Local sessions"
        self._scan_state = ScanState()
        self._records: list[Record] = []
        self.query_one(StatsPanel).show(None)
        self.refresh_limits()
        self.refresh_stats()
        self.refresh_sessions()
        self.set_interval(60, self.refresh_limits)
        self.set_interval(30, self.refresh_stats)
        self.set_interval(10, self.refresh_sessions)

    def action_refresh(self) -> None:
        self.refresh_limits()
        self.refresh_stats()
        self.refresh_sessions()

    def refresh_limits(self) -> None:
        self.run_worker(self._load_limits, thread=True, exclusive=True, group="limits")

    def refresh_stats(self) -> None:
        self.run_worker(self._load_stats, thread=True, exclusive=True, group="stats")

    def refresh_sessions(self) -> None:
        self.run_worker(self._load_sessions, thread=True, exclusive=True, group="sessions")

    def _load_limits(self) -> None:
        try:
            limits = fetch_limits()
        except Exception as exc:  # degrade, never crash the panel
            self.call_from_thread(
                self.query_one(LimitsPanel).show, None, f"unavailable: {type(exc).__name__}"
            )
            return
        self.call_from_thread(self.query_one(LimitsPanel).show, limits, None)

    def _load_stats(self) -> None:
        try:
            self._records.extend(scan_transcripts(PROJECTS_ROOT, self._scan_state))
            stats = aggregate(self._records, now=datetime.now(timezone.utc))
        except Exception:
            return
        self.call_from_thread(self.query_one(StatsPanel).show, stats)

    def _load_sessions(self) -> None:
        try:
            sessions = recent_sessions(PROJECTS_ROOT)
            count = count_claude_processes()
        except Exception:
            return
        self.call_from_thread(self.query_one(SessionsPanel).show, sessions, count)


def main() -> None:
    UsageApp().run()


if __name__ == "__main__":
    main()
