"""State machine: legal/illegal transitions, actor enforcement, kind guards."""

import pytest

from studio.state import (
    STATES,
    Actor,
    IllegalTransition,
    NotAllowedForActor,
    check_transition,
)


def test_all_states_known():
    for s in (
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
    ):
        assert s in STATES


def test_happy_path_feature():
    path = [
        ("backlog", "prd:drafting", Actor.HUMAN),
        ("prd:drafting", "prd:review", Actor.AGENT),
        ("prd:review", "prd:approved", Actor.HUMAN),
        ("prd:approved", "design:drafting", Actor.ORCHESTRATOR),
        ("design:drafting", "design:review", Actor.AGENT),
        ("design:review", "design:approved", Actor.HUMAN),
        ("design:approved", "ready", Actor.ORCHESTRATOR),
        ("ready", "coding", Actor.ORCHESTRATOR),
        ("coding", "pr:agent-review", Actor.AGENT),
        ("pr:agent-review", "pr:human-review", Actor.ORCHESTRATOR),
        ("pr:human-review", "done", Actor.HUMAN),
    ]
    for frm, to, actor in path:
        check_transition(frm, to, actor)  # must not raise


def test_review_loop_transitions():
    check_transition("pr:agent-review", "pr:changes-requested", Actor.ORCHESTRATOR)
    check_transition("pr:changes-requested", "coding", Actor.ORCHESTRATOR)


def test_spec_iteration_loops():
    check_transition("prd:review", "prd:drafting", Actor.HUMAN)
    check_transition("design:review", "design:drafting", Actor.HUMAN)


def test_human_only_transitions_reject_agent_actor():
    for frm, to in (
        ("prd:review", "prd:approved"),
        ("design:review", "design:approved"),
        ("pr:human-review", "done"),
    ):
        with pytest.raises(NotAllowedForActor):
            check_transition(frm, to, Actor.AGENT)
        with pytest.raises(NotAllowedForActor):
            check_transition(frm, to, Actor.ORCHESTRATOR)


def test_agents_cannot_promote_to_human_review():
    with pytest.raises(NotAllowedForActor):
        check_transition("pr:agent-review", "pr:human-review", Actor.AGENT)


def test_illegal_transition_raises():
    with pytest.raises(IllegalTransition):
        check_transition("backlog", "done", Actor.HUMAN)
    with pytest.raises(IllegalTransition):
        check_transition("coding", "prd:review", Actor.AGENT)


def test_unknown_state_raises():
    with pytest.raises(IllegalTransition):
        check_transition("backlog", "nonsense", Actor.HUMAN)
    with pytest.raises(IllegalTransition):
        check_transition("nonsense", "backlog", Actor.HUMAN)


def test_bug_may_skip_prd():
    check_transition("backlog", "design:drafting", Actor.HUMAN, kind="bug")


def test_feature_may_not_skip_prd():
    with pytest.raises(IllegalTransition):
        check_transition("backlog", "design:drafting", Actor.HUMAN, kind="feature")


def test_any_state_may_escalate_to_needs_human():
    for frm in STATES - {"needs-human", "done"}:
        check_transition(frm, "needs-human", Actor.AGENT)


def test_human_reroutes_from_needs_human():
    check_transition("needs-human", "coding", Actor.HUMAN)
    check_transition("needs-human", "backlog", Actor.HUMAN)
    with pytest.raises(NotAllowedForActor):
        check_transition("needs-human", "coding", Actor.AGENT)
