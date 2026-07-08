"""The work-item state machine: states, legal transitions, and who may make them.

The two human gates (spec approval, merge authority) are enforced here at the code
level — a transition attempted by the wrong actor class raises, it is never just
discouraged in a prompt.
"""

from __future__ import annotations

from enum import Enum


class Actor(str, Enum):
    HUMAN = "human"
    AGENT = "agent"
    ORCHESTRATOR = "orchestrator"


class TransitionError(Exception):
    """Base class for refused transitions."""


class IllegalTransition(TransitionError):
    """No edge exists between these states (or a state is unknown)."""


class NotAllowedForActor(TransitionError):
    """The edge exists but this actor class may not take it."""


STATES: frozenset[str] = frozenset(
    {
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
        "improve:drafting",
        "improve:review",
        "improve:approved",
    }
)

KINDS: frozenset[str] = frozenset({"feature", "bug", "chore", "improvement"})

# The improvement pipeline is a separate world: improvement items live only in
# these states (plus needs-human and done), and no other kind may enter them.
IMPROVE_STATES: frozenset[str] = frozenset(
    {"improve:drafting", "improve:review", "improve:approved"}
)
_IMPROVEMENT_ALLOWED: frozenset[str] = IMPROVE_STATES | {"needs-human", "done"}


def kind_state_conflict(state: str, kind: str) -> str | None:
    """Return an error message if this kind may never occupy this state (R7)."""
    if state in IMPROVE_STATES and kind != "improvement":
        return f"kind {kind!r} may not enter improvement state {state!r}"
    if kind == "improvement" and state not in _IMPROVEMENT_ALLOWED:
        return f"improvement items may not enter {state!r} (improve:* states only)"
    return None

_H = frozenset({Actor.HUMAN})
_A = frozenset({Actor.AGENT})
_O = frozenset({Actor.ORCHESTRATOR})
_HO = _H | _O
_AO = _A | _O

# (from, to) -> actor classes allowed to take the edge.
TRANSITIONS: dict[tuple[str, str], frozenset[Actor]] = {
    ("backlog", "prd:drafting"): _HO,
    ("backlog", "design:drafting"): _HO,  # kind guard: bugs only, see check_transition
    ("prd:drafting", "prd:review"): _A,
    ("prd:review", "prd:drafting"): _H,  # human requests another PRD iteration
    ("prd:review", "prd:approved"): _H,  # HUMAN GATE: spec approval
    ("prd:approved", "design:drafting"): _HO,
    ("design:drafting", "design:review"): _A,
    ("design:review", "design:drafting"): _H,
    ("design:review", "design:approved"): _H,  # HUMAN GATE: design approval
    ("design:approved", "ready"): _HO,
    ("ready", "coding"): _AO,
    ("coding", "pr:agent-review"): _A,
    ("pr:agent-review", "pr:changes-requested"): _O,  # any reviewer verdict is CHANGES
    ("pr:changes-requested", "coding"): _AO,
    ("pr:agent-review", "pr:human-review"): _O,  # fired only when all verdicts APPROVE
    ("pr:human-review", "done"): _H,  # HUMAN GATE: merge authority
    ("improve:drafting", "improve:review"): _AO,  # valid proposal posted
    ("improve:review", "improve:approved"): _H,  # HUMAN GATE: prompt-change approval
    ("improve:approved", "done"): _HO,  # harness applied the diff
}


def check_transition(
    from_state: str, to_state: str, actor: Actor, kind: str = "feature"
) -> None:
    """Validate a transition; raise IllegalTransition or NotAllowedForActor.

    Escalation (any state -> needs-human) is open to every actor; leaving
    needs-human is human-only, to any state.
    """
    if from_state not in STATES:
        raise IllegalTransition(f"unknown state {from_state!r}")
    if to_state not in STATES:
        raise IllegalTransition(f"unknown state {to_state!r}")

    conflict = kind_state_conflict(to_state, kind)
    if conflict is not None:
        raise IllegalTransition(conflict)

    if to_state == "needs-human":
        return
    if from_state == "needs-human":
        if actor is not Actor.HUMAN:
            raise NotAllowedForActor("only a human may re-route a needs-human item")
        return

    allowed = TRANSITIONS.get((from_state, to_state))
    if allowed is None:
        raise IllegalTransition(f"no transition {from_state!r} -> {to_state!r}")
    if (from_state, to_state) == ("backlog", "design:drafting") and kind != "bug":
        raise IllegalTransition(f"only bugs may skip the PRD (kind={kind!r})")
    if actor not in allowed:
        raise NotAllowedForActor(
            f"{actor.value} may not transition {from_state!r} -> {to_state!r} "
            f"(allowed: {', '.join(sorted(a.value for a in allowed))})"
        )
