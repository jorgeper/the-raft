"""Contract test for the Lab-6 LinearTracker stub: any Tracker backend must pass
exactly this shape of test — copy it when you write your own backend."""

import pytest

from studio.state import Actor, NotAllowedForActor
from studio.tracker.base import Tracker, TrackerError
from studio.tracker.linear import LinearTracker


@pytest.fixture
def tracker() -> Tracker:
    return LinearTracker(team="STU")


def test_satisfies_the_abc(tracker):
    assert isinstance(tracker, Tracker)


def test_create_get_list(tracker):
    item = tracker.create("Add login", "body", "backlog")
    assert item.id == "1" and item.url.startswith("linear://STU/")
    assert tracker.get("1").title == "Add login"
    tracker.create("Fix crash", "", "backlog", kind="bug")
    assert [i.id for i in tracker.list(state="backlog")] == ["1", "2"]
    assert [i.id for i in tracker.list(kind="bug")] == ["2"]
    with pytest.raises(TrackerError, match="no such item"):
        tracker.get("99")


def test_comments_round_trip(tracker):
    tracker.create("a", "", "backlog")
    tracker.comment("1", "the PRD", author="prd")
    assert [(c.author, c.body) for c in tracker.comments("1")] == [("prd", "the PRD")]


def test_transition_validates_through_the_state_machine(tracker):
    tracker.create("a", "", "prd:review")
    with pytest.raises(NotAllowedForActor):
        tracker.transition("1", "prd:approved", Actor.AGENT)  # human gate holds
    tracker.transition("1", "prd:approved", Actor.HUMAN)
    assert tracker.get("1").state == "prd:approved"


def test_claim_is_single_flight(tracker):
    tracker.create("a", "", "ready")
    assert tracker.claim("1", "coder") is True
    assert tracker.claim("1", "rival") is False
    assert tracker.claim("1", "coder") is True  # idempotent for the holder
    tracker.release("1", "rival")  # not the holder: no-op
    assert tracker.get("1").claimed_by == "coder"
    tracker.release("1", "coder")
    assert tracker.claim("1", "rival") is True
