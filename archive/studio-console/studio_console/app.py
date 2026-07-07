"""The Textual app: four screens over one ConsoleState, fed by a tailer (live)
or a replay iterator (demo). Read-only by design."""

from __future__ import annotations

import time
from pathlib import Path

from textual.app import App, ComposeResult
from textual.containers import Horizontal, VerticalScroll
from textual.screen import ModalScreen, Screen
from textual.widgets import DataTable, Footer, Header, Markdown, Static

from studio_console.config import ConsoleConfig, load_config
from studio_console.events import Event, parse_line
from studio_console.replay import load_events
from studio_console.snapshot import SnapshotClient
from studio_console.state import ConsoleState
from studio_console.tailer import EventTailer
from studio_console.widgets import panels

REFRESH_S = 0.5


class BaseScreen(Screen):
    """Shared refresh plumbing: subclasses implement refresh_view()."""

    def on_mount(self) -> None:
        self.set_interval(REFRESH_S, self.refresh_view)
        self.refresh_view()

    @property
    def state(self) -> ConsoleState:
        return self.app.state  # type: ignore[attr-defined]

    def refresh_view(self) -> None:  # pragma: no cover - overridden
        pass


class DashboardScreen(BaseScreen):
    BINDINGS = [("o", "toggle_output_events", "output events in feed")]

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        yield Static(id="counts")
        with Horizontal():
            yield Static(id="active", classes="panel")
            feed = DataTable(id="feed", cursor_type="row", classes="panel")
            feed.add_columns("time", "event", "where", "detail")
            yield feed
        yield Static(id="live", classes="livepane")
        yield Footer()

    def refresh_view(self) -> None:
        self.query_one("#counts", Static).update(panels.counts_line(self.state))
        self.query_one("#active", Static).update(panels.active_table(self.state))
        self.query_one("#live", Static).update(panels.live_output(self.state))
        feed = self.query_one("#feed", DataTable)
        app: ConsoleApp = self.app  # type: ignore[assignment]
        # tail -f semantics: auto-follow ONLY while the cursor is at the bottom;
        # a user browsing older rows must never be yanked back down.
        following = feed.row_count == 0 or feed.cursor_row >= feed.row_count - 1
        added = False
        while app.feed_cursor < len(app.feed_log):
            event = app.feed_log[app.feed_cursor]
            # agent_output goes to the live pane, not the feed (toggle with `o`)
            if event.kind != "agent_output" or app.show_output_events:
                feed.add_row(*panels.feed_row(event), key=str(app.feed_cursor))
                added = True
            app.feed_cursor += 1
        if added and following and feed.row_count:
            feed.move_cursor(row=feed.row_count - 1)

    def action_toggle_output_events(self) -> None:
        app: ConsoleApp = self.app  # type: ignore[assignment]
        app.show_output_events = not app.show_output_events
        feed = self.query_one("#feed", DataTable)
        feed.clear()
        app.feed_cursor = 0
        self.refresh_view()

    def on_data_table_row_selected(self, message: DataTable.RowSelected) -> None:
        app: ConsoleApp = self.app  # type: ignore[assignment]
        index = int(message.row_key.value or 0)
        if 0 <= index < len(app.feed_log):
            self.app.push_screen(EventDetailScreen(app.feed_log[index]))


class BoardScreen(BaseScreen):
    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        table = DataTable(id="board", cursor_type="row")
        table.add_columns("", "id", "title", "kind", "claimed")
        yield table
        yield Footer()

    def refresh_view(self) -> None:
        table = self.query_one("#board", DataTable)
        cursor = table.cursor_row
        table.clear()
        self._row_items: list[str | None] = []
        for section, item in panels.board_rows(self.state):
            if item is None:
                table.add_row(panels.state_text(section), "", "", "", "")
                self._row_items.append(None)
            else:
                table.add_row("", f"#{item.id}", item.title, item.kind, item.claimed_by or "")
                self._row_items.append(item.id)
        if table.row_count and cursor is not None:
            table.move_cursor(row=min(cursor, table.row_count - 1))

    def on_data_table_row_selected(self, message: DataTable.RowSelected) -> None:
        items = getattr(self, "_row_items", [])
        if 0 <= message.cursor_row < len(items) and items[message.cursor_row]:
            self.app.push_screen(ItemDetailScreen(items[message.cursor_row]))


class ItemDetailScreen(Screen):
    BINDINGS = [("escape", "app.pop_screen", "back")]

    def __init__(self, item_id: str) -> None:
        super().__init__()
        self.item_id = item_id

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with VerticalScroll():
            yield Markdown(id="detail")
        yield Footer()

    def on_mount(self) -> None:
        app: ConsoleApp = self.app  # type: ignore[assignment]
        view = app.state.items.get(self.item_id)
        snapshot = app.snapshot.show(self.item_id) if app.snapshot else None
        if view:
            self.query_one("#detail", Markdown).update(panels.item_markdown(view, snapshot))


class RunsScreen(BaseScreen):
    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        table = DataTable(id="runs", cursor_type="row")
        table.add_columns("run", "files")
        yield table
        yield Footer()

    def refresh_view(self) -> None:
        table = self.query_one("#runs", DataTable)
        app: ConsoleApp = self.app  # type: ignore[assignment]
        runs_dir = app.config.runs_dir if app.config else None
        cursor = table.cursor_row
        table.clear()
        self._runs: list[Path] = []
        if runs_dir and runs_dir.is_dir():
            for run in sorted(runs_dir.iterdir(), reverse=True)[:200]:
                if run.is_dir():
                    files = ", ".join(sorted(p.name for p in run.iterdir()))
                    table.add_row(run.name, files)
                    self._runs.append(run)
        if not self._runs:
            table.add_row("(no runs directory — replay mode?)", "")
        if table.row_count and cursor is not None:
            table.move_cursor(row=min(cursor, table.row_count - 1))

    def on_data_table_row_selected(self, message: DataTable.RowSelected) -> None:
        runs = getattr(self, "_runs", [])
        if 0 <= message.cursor_row < len(runs):
            self.app.push_screen(RunViewScreen(runs[message.cursor_row]))


class RunViewScreen(Screen):
    BINDINGS = [("escape", "app.pop_screen", "back")]

    def __init__(self, run_dir: Path) -> None:
        super().__init__()
        self.run_dir = run_dir

    def compose(self) -> ComposeResult:
        yield Header(show_clock=True)
        with VerticalScroll():
            yield Markdown(id="run")
        yield Footer()

    def on_mount(self) -> None:
        parts = [f"# {self.run_dir.name}"]
        for name in ("prompt.md", "output.md"):
            path = self.run_dir / name
            if path.is_file():
                parts += [f"\n## {name}\n", path.read_text()]
        self.query_one("#run", Markdown).update("\n".join(parts))


class EventDetailScreen(ModalScreen):
    BINDINGS = [("escape", "app.pop_screen", "back")]

    def __init__(self, event: Event) -> None:
        super().__init__()
        self.event = event

    def compose(self) -> ComposeResult:
        with VerticalScroll(id="event-modal"):
            yield Markdown(panels.event_detail(self.event))


class HelpScreen(ModalScreen):
    BINDINGS = [("escape", "app.pop_screen", "back")]

    HELP = """# studio-console

| key | action |
|---|---|
| 1 | dashboard (active agents, event feed, live output pane) |
| o | toggle agent_output events in the feed (they stream to the live pane) |
| 2 | board (backlog by state; enter opens an item) |
| 3 | runs browser (enter opens a run) |
| enter | expand the selected row |
| escape | back |
| q | quit |

Read-only by design: approving and merging happen in `studio approve` and your
own hands. See the README for pointing this at a real studio.
"""

    def compose(self) -> ComposeResult:
        with VerticalScroll(id="help-modal"):
            yield Markdown(self.HELP)


class ConsoleApp(App):
    TITLE = "studio-console"
    CSS = """
    Horizontal > .panel { width: 1fr; border: round $primary; }
    #counts { height: 1; padding: 0 1; }
    .livepane { height: 8; border: round $secondary; padding: 0 1; overflow-y: hidden; }
    #event-modal, #help-modal {
        width: 80%; height: 80%; margin: 2 4;
        background: $surface; border: thick $primary;
    }
    """
    BINDINGS = [
        ("1", "show('dashboard')", "dashboard"),
        ("2", "show('board')", "board"),
        ("3", "show('runs')", "runs"),
        ("q", "quit", "quit"),
        ("question_mark", "help", "help"),
    ]
    SCREENS = {"dashboard": DashboardScreen, "board": BoardScreen, "runs": RunsScreen}

    def __init__(
        self,
        config_path: Path | None = None,
        replay_path: Path | None = None,
        speed: float = 10.0,
    ) -> None:
        super().__init__()
        self.state = ConsoleState()
        self.feed_log: list[Event] = []  # append-only; the dashboard consumes a cursor
        self.feed_cursor = 0
        self.show_output_events = False  # agent_output stays out of the feed by default
        self.replay_path = replay_path
        self.speed = speed
        self.config: ConsoleConfig | None = None
        self.snapshot: SnapshotClient | None = None
        self.tailer: EventTailer | None = None
        self._replay_queue: list[Event] = []
        self._replay_next_at = 0.0
        if replay_path is None:
            self.config = load_config(config_path or Path("config.yaml"))
            self.snapshot = SnapshotClient(self.config.studio_root, self.config.studio_python)
            self.tailer = EventTailer(self.config.events_path)

    # ------------------------------------------------------------- data pump

    def _apply(self, event: Event) -> None:
        self.state.apply(event)
        self.feed_log.append(event)

    def on_mount(self) -> None:
        if self.replay_path is not None:
            events, errors = load_events(self.replay_path)
            self.state.parse_errors = errors
            if self.speed <= 0:  # instant replay (tests)
                for event in events:
                    self._apply(event)
            else:
                self._replay_queue = events
                self._replay_next_at = time.monotonic()
                self.set_interval(0.05, self._pump_replay)
        else:
            self.set_interval((self.config.events_poll_ms if self.config else 250) / 1000,
                              self._pump_live)
            self.set_interval(self.config.snapshot_poll_s if self.config else 5,
                              self._pump_snapshot)
            self._pump_snapshot()
        self.push_screen("dashboard")

    def _pump_replay(self) -> None:
        now = time.monotonic()
        while self._replay_queue and now >= self._replay_next_at:
            event = self._replay_queue.pop(0)
            self._apply(event)
            if self._replay_queue:
                gap = _gap_seconds(event.ts, self._replay_queue[0].ts) / max(self.speed, 0.1)
                self._replay_next_at = now + min(gap, 2.0)

    def _pump_live(self) -> None:
        if self.tailer is None:
            return
        for line in self.tailer.poll():
            try:
                event = parse_line(line)
            except ValueError:
                self.state.parse_errors += 1
                continue
            if event is not None:
                self._apply(event)

    def _pump_snapshot(self) -> None:
        if self.snapshot is None:
            return
        status = self.snapshot.status()
        if status:
            self.state.apply_snapshot(status)

    # --------------------------------------------------------------- actions

    def action_show(self, name: str) -> None:
        if self.screen is not self.get_screen(name):
            self.switch_screen(name)

    def action_help(self) -> None:
        self.push_screen(HelpScreen())


def _gap_seconds(a: str, b: str) -> float:
    from datetime import datetime

    try:
        return max(0.0, (datetime.fromisoformat(b) - datetime.fromisoformat(a)).total_seconds())
    except ValueError:
        return 0.0
