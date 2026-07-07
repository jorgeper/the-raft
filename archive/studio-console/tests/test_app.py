"""Textual pilot smoke tests: the app boots headless on the fixture and the
screens render real content."""

from pathlib import Path

from textual.widgets import DataTable, Static

from studio_console.app import ConsoleApp

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "demo-events.jsonl"


def make_app() -> ConsoleApp:
    return ConsoleApp(replay_path=FIXTURE, speed=0)  # speed 0 = instant replay


async def test_app_boots_on_fixture():
    app = make_app()
    async with app.run_test() as pilot:
        await pilot.pause()
        # the fixture stream fully folded into state
        assert app.state.items["1"].state == "done"
        assert {"prd", "architect", "coder"} <= app.state.agents_seen
        # dashboard renders counts and the feed table has the events
        counts = app.screen.query_one("#counts", Static)
        assert "done 1" in str(counts.render())  # textual 8: render() -> Content
        feed = app.screen.query_one("#feed", DataTable)
        assert feed.row_count >= 40


async def test_board_navigation_reaches_item_detail():
    app = make_app()
    async with app.run_test() as pilot:
        await pilot.pause()
        await pilot.press("2")
        await pilot.pause()
        board = app.screen.query_one("#board", DataTable)
        assert board.row_count >= 2  # a section header + the item
        # move to the item row and open it
        board.move_cursor(row=1)
        await pilot.press("enter")
        await pilot.pause()
        assert app.screen.__class__.__name__ == "ItemDetailScreen"
        await pilot.press("escape")
        await pilot.pause()
        assert app.screen.__class__.__name__ == "BoardScreen"


async def test_help_overlay_and_quit():
    app = make_app()
    async with app.run_test() as pilot:
        await pilot.pause()
        await pilot.press("question_mark")
        await pilot.pause()
        assert app.screen.__class__.__name__ == "HelpScreen"
        await pilot.press("escape")
        await pilot.pause()
        await pilot.press("q")
    assert app.return_code in (0, None)


async def test_runs_screen_handles_missing_dir():
    app = make_app()
    async with app.run_test() as pilot:
        await pilot.pause()
        await pilot.press("3")
        await pilot.pause()
        runs = app.screen.query_one("#runs", DataTable)
        assert runs.row_count == 1  # the "(no runs directory)" placeholder


async def test_live_pane_shows_streamed_text():
    app = make_app()
    async with app.run_test() as pilot:
        await pilot.pause()
        live = app.screen.query_one("#live", Static)
        text = str(live.render())
        # the fixture's last streamed chunk (reviewer-a) is on the pane
        assert "(finished)" in text
        assert "ran the gates myself" in text or "all green" in text


async def test_feed_excludes_agent_output_by_default_toggle_o():
    app = make_app()
    async with app.run_test() as pilot:
        await pilot.pause()
        feed = app.screen.query_one("#feed", DataTable)
        without = feed.row_count
        assert without == sum(1 for e in app.feed_log if e.kind != "agent_output")
        await pilot.press("o")
        await pilot.pause()
        assert feed.row_count == len(app.feed_log)  # toggled in
        await pilot.press("o")
        await pilot.pause()
        assert feed.row_count == without  # toggled back out
