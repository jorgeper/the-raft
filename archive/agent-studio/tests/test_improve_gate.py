"""Improvement pipeline state machine (self-improve-spec R6/R7): the human gate
on improve:review is enforced in code, and the improvement kind guard works in
both directions."""

import pytest

from studio.state import (
    Actor,
    IllegalTransition,
    NotAllowedForActor,
    check_transition,
    kind_state_conflict,
)
from studio.tracker.base import TrackerError
from studio.tracker.markdown import MarkdownTracker

# --- R6: the human gate ----------------------------------------------------


def test_improve_states_exist_with_edges():
    """R6: the improve pipeline edges are legal for their intended actors."""
    check_transition("improve:drafting", "improve:review", Actor.AGENT, kind="improvement")
    check_transition("improve:drafting", "improve:review", Actor.ORCHESTRATOR, kind="improvement")
    check_transition("improve:review", "improve:approved", Actor.HUMAN, kind="improvement")
    check_transition("improve:approved", "done", Actor.HUMAN, kind="improvement")
    check_transition("improve:approved", "done", Actor.ORCHESTRATOR, kind="improvement")


@pytest.mark.parametrize("actor", [Actor.AGENT, Actor.ORCHESTRATOR])
def test_improve_approval_is_human_only(actor):
    """R6: improve:review -> improve:approved rejects agent and orchestrator actors."""
    with pytest.raises(NotAllowedForActor):
        check_transition("improve:review", "improve:approved", actor, kind="improvement")


def test_improve_escalation_open_to_all():
    """Any actor may escalate an improvement item to needs-human."""
    check_transition("improve:review", "needs-human", Actor.ORCHESTRATOR, kind="improvement")
    check_transition("improve:drafting", "needs-human", Actor.AGENT, kind="improvement")


# --- R7: kind guard, both directions ----------------------------------------


def test_non_improvement_kind_cannot_enter_improve_states():
    """R7: a feature item can never be routed into the improve pipeline."""
    with pytest.raises(IllegalTransition, match="improve"):
        check_transition("needs-human", "improve:drafting", Actor.HUMAN, kind="feature")
    with pytest.raises(IllegalTransition):
        check_transition("improve:drafting", "improve:review", Actor.AGENT, kind="bug")


def test_improvement_kind_cannot_enter_delivery_states():
    """R7: an improvement item can never be routed into the delivery pipeline."""
    with pytest.raises(IllegalTransition, match="improvement"):
        check_transition("needs-human", "ready", Actor.HUMAN, kind="improvement")
    with pytest.raises(IllegalTransition, match="improvement"):
        check_transition("needs-human", "prd:drafting", Actor.HUMAN, kind="improvement")


def test_improvement_kind_may_reach_done_and_needs_human():
    assert kind_state_conflict("done", "improvement") is None
    assert kind_state_conflict("needs-human", "improvement") is None
    assert kind_state_conflict("improve:review", "improvement") is None
    assert kind_state_conflict("coding", "improvement") is not None
    assert kind_state_conflict("improve:review", "feature") is not None


# --- creation respects the guard too -----------------------------------------


def test_tracker_create_enforces_kind_guard(tmp_path):
    """R7: creation cannot smuggle a feature into improve:* or an improvement
    into the delivery pipeline — the guard is not transition-only."""
    tracker = MarkdownTracker(tmp_path / ".work")
    with pytest.raises(TrackerError, match="improve"):
        tracker.create("sneaky", "", "improve:drafting", kind="feature")
    with pytest.raises(TrackerError, match="improvement"):
        tracker.create("sneaky", "", "backlog", kind="improvement")
    item = tracker.create("real proposal", "scorecard...", "improve:drafting", kind="improvement")
    assert item.state == "improve:drafting"
    assert item.kind == "improvement"


def test_improvement_item_full_path(tmp_path):
    """An improvement item walks drafting -> review -> approved -> done."""
    tracker = MarkdownTracker(tmp_path / ".work")
    item = tracker.create("proposal", "", "improve:drafting", kind="improvement")
    tracker.transition(item.id, "improve:review", Actor.AGENT)
    with pytest.raises(NotAllowedForActor):
        tracker.transition(item.id, "improve:approved", Actor.AGENT)
    tracker.transition(item.id, "improve:approved", Actor.HUMAN)
    tracker.transition(item.id, "done", Actor.HUMAN)
    assert tracker.get(item.id).state == "done"
