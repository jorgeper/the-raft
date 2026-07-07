"""MarkdownTracker: CRUD, comments, claims, transitions, board rendering."""

import pytest

from studio.state import Actor, NotAllowedForActor
from studio.tracker.markdown import MarkdownTracker


@pytest.fixture
def tracker(tmp_path):
    return MarkdownTracker(tmp_path / ".work")


def test_create_and_get(tracker):
    item = tracker.create("Add login", "Users need to log in", "backlog")
    assert item.id == "1"
    got = tracker.get("1")
    assert got.title == "Add login"
    assert got.body == "Users need to log in"
    assert got.state == "backlog"
    assert got.kind == "feature"
    assert got.created


def test_ids_increment(tracker):
    tracker.create("a", "", "backlog")
    tracker.create("b", "", "backlog")
    assert tracker.create("c", "", "backlog").id == "3"


def test_get_missing_raises(tracker):
    from studio.tracker.base import TrackerError

    with pytest.raises(TrackerError, match="no such item"):
        tracker.get("99")


def test_list_filters_by_state_and_kind(tracker):
    tracker.create("a", "", "backlog")
    tracker.create("b", "", "prd:drafting")
    tracker.create("c", "", "backlog", kind="bug")
    assert [i.id for i in tracker.list()] == ["1", "2", "3"]
    assert [i.id for i in tracker.list(state="backlog")] == ["1", "3"]
    assert [i.id for i in tracker.list(state="backlog", kind="bug")] == ["3"]


def test_comments_round_trip(tracker):
    tracker.create("a", "body text", "backlog")
    tracker.comment("1", "First!\n\nWith **markdown**.", author="prd")
    tracker.comment("1", "Reply", author="human")
    comments = tracker.comments("1")
    assert [(c.author, c.body.splitlines()[0]) for c in comments] == [
        ("prd", "First!"),
        ("human", "Reply"),
    ]
    # body untouched by comments
    assert tracker.get("1").body == "body text"


def test_transition_validates_actor(tracker):
    tracker.create("a", "", "prd:review")
    with pytest.raises(NotAllowedForActor):
        tracker.transition("1", "prd:approved", Actor.AGENT)
    tracker.transition("1", "prd:approved", Actor.HUMAN)
    assert tracker.get("1").state == "prd:approved"


def test_claim_is_single_flight(tracker):
    tracker.create("a", "", "ready")
    assert tracker.claim("1", "coder") is True
    assert tracker.claim("1", "other-coder") is False
    assert tracker.claim("1", "coder") is True  # idempotent for the holder
    assert tracker.get("1").claimed_by == "coder"


def test_release_allows_reclaim(tracker):
    tracker.create("a", "", "ready")
    tracker.claim("1", "coder")
    tracker.release("1", "someone-else")  # no-op: not the holder
    assert tracker.get("1").claimed_by == "coder"
    tracker.release("1", "coder")
    assert tracker.get("1").claimed_by == ""
    assert tracker.claim("1", "other-coder") is True


def test_board_renders_grouped_by_state(tracker, tmp_path):
    tracker.create("Login", "", "backlog")
    tracker.create("Signup", "", "coding")
    board = (tmp_path / ".work" / "board.md").read_text()
    assert "## backlog" in board
    assert "- #1 Login [feature]" in board
    assert "## coding" in board
    assert board.index("## backlog") < board.index("## coding")
