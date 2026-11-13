"""Reflection (self-improve-spec R13–R15): LESSON: lines are parsed by the
HARNESS and appended to the role journal — reflection is guaranteed, not advisory."""

from test_orchestrator import make_world

from studio.reflection import MAX_LESSON_CHARS, MAX_LESSONS_PER_RUN, harvest_lessons


class RecordingEvents:
    def __init__(self):
        self.records = []

    def emit(self, event, *, item=None, agent=None, **data):
        self.records.append((event, item, agent, data))

    def bound(self, *, item=None, agent=None):
        return self


# --- R13/R14: parsing and bounds ---------------------------------------------


def test_harvest_appends_lessons_with_item_prefix(tmp_path):
    journal = tmp_path / "memory" / "coder" / "journal.md"
    output = "did the work\nLESSON: run the gates before editing\ndone\n"
    kept = harvest_lessons(output, journal, item_id="7", agent="coder")
    assert kept == ["run the gates before editing"]
    assert "- [#7] run the gates before editing" in journal.read_text()


def test_harvest_caps_at_three_and_truncates(tmp_path):
    """R14: max 3 lessons persisted per run, each capped at 200 chars."""
    journal = tmp_path / "journal.md"
    output = "\n".join([f"LESSON: lesson number {n} " + "x" * 300 for n in range(5)])
    events = RecordingEvents()
    kept = harvest_lessons(output, journal, item_id="1", agent="prd", events=events)
    assert len(kept) == MAX_LESSONS_PER_RUN == 3
    assert all(len(lesson) <= MAX_LESSON_CHARS == 200 for lesson in kept)
    assert len(journal.read_text().splitlines()) == 3
    dropped = [r for r in events.records if r[0] == "lessons_dropped"]
    assert dropped and dropped[0][3]["count"] == 2


def test_no_lessons_is_not_an_error(tmp_path):
    """R14: a run with no LESSON lines appends nothing and creates no file."""
    journal = tmp_path / "journal.md"
    assert harvest_lessons("all done, nothing learned", journal, item_id="1", agent="prd") == []
    assert not journal.exists()


def test_lesson_events_emitted(tmp_path):
    """R15: every persisted lesson emits a `lesson` event with item/agent/text."""
    events = RecordingEvents()
    harvest_lessons(
        "LESSON: one\nLESSON: two", tmp_path / "j.md", item_id="4", agent="reviewer-a",
        events=events,
    )
    lessons = [r for r in events.records if r[0] == "lesson"]
    assert [(r[1], r[2], r[3]["text"]) for r in lessons] == [
        ("4", "reviewer-a", "one"),
        ("4", "reviewer-a", "two"),
    ]


# --- R13: the orchestrator harvests for commenters and reviewers ---------------


def test_commenter_output_is_harvested(tmp_path):
    cfg, tracker, claude_rt, _, orch, _ = make_world(
        tmp_path, responses=["# PRD\nLESSON: ask for the deadline up front\n"]
    )
    tracker.create("Add login", "we need auth", "prd:drafting")
    orch.tick()
    journal = cfg.root / "memory" / "prd" / "journal.md"
    assert "- [#1] ask for the deadline up front" in journal.read_text()


def test_reviewer_output_is_harvested(tmp_path):
    cfg, tracker, claude_rt, codex_rt, orch, _ = make_world(
        tmp_path, responses=["fine\nLESSON: check error paths first\nVERDICT: APPROVE"]
    )
    codex_rt.script("also fine\nVERDICT: APPROVE")
    tracker.create("Add login", "we need auth", "pr:agent-review")
    orch.tick()
    journal = cfg.root / "memory" / "reviewer" / "journal.md"
    assert "- [#1] check error paths first" in journal.read_text()


# --- R13: the coder's lessons are harvested per loop iteration -----------------


def test_goal_loop_calls_output_hook_each_iteration(tmp_path):
    """The loop exposes each iteration's raw output to the harness hook."""
    from studio.execution import CommandExecutor
    from studio.loop import Goal, GoalLoop
    from studio.runtime.fake import FakeRuntime

    runtime = FakeRuntime(["no plan from me\nLESSON: plan first", "still no plan"])
    loop = GoalLoop(runtime, executor=CommandExecutor())
    seen = []
    loop.output_hook = seen.append
    (tmp_path / "wd").mkdir()
    loop.run("base", tmp_path / "wd", Goal(max_iterations=2, max_minutes=5))
    assert seen == ["no plan from me\nLESSON: plan first", "still no plan"]
