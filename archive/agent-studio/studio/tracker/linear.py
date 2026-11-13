"""LinearTracker — a stub/template for a third tracker backend (Lab 6).

This implements the full Tracker contract against an in-memory store, with the
Linear-specific wiring points marked. To make it real: replace each `_api` call
site with a GraphQL request to https://api.linear.app/graphql (issues map to work
items, workflow states or labels map to studio states, comments map to comments).

What this stub already gets right — and what any real backend must keep:
- transition() validates through the one state machine (check_transition).
- claim() is single-flight and idempotent for the holder.
- The orchestrator can run against it unchanged.
"""

from __future__ import annotations

import itertools
from dataclasses import replace
from datetime import UTC, datetime

from studio.state import KINDS, STATES, Actor, check_transition
from studio.tracker.base import Comment, Tracker, TrackerError, WorkItem


class LinearTracker(Tracker):
    def __init__(self, team: str) -> None:
        self.team = team  # a real impl also takes an API-key executor here
        self._items: dict[str, WorkItem] = {}
        self._ids = itertools.count(1)

    def _api(self, operation: str, **variables):  # the GraphQL seam, one place
        raise NotImplementedError(
            f"wire {operation} to Linear's GraphQL API (variables: {sorted(variables)})"
        )

    # -- Tracker contract --------------------------------------------------

    def create(self, title: str, body: str, state: str, kind: str = "feature") -> WorkItem:
        if state not in STATES:
            raise TrackerError(f"unknown state: {state}")
        if kind not in KINDS:
            raise TrackerError(f"unknown kind: {kind}")
        item_id = str(next(self._ids))
        now = datetime.now(UTC).isoformat(timespec="seconds")
        item = WorkItem(
            id=item_id, title=title, body=body, state=state, kind=kind,
            url=f"linear://{self.team}/{item_id}", created=now, updated=now,
        )
        self._items[item_id] = item  # real: self._api("issueCreate", ...)
        return item

    def get(self, item_id: str) -> WorkItem:
        if item_id not in self._items:  # real: self._api("issue", id=item_id)
            raise TrackerError(f"no such item: {item_id}")
        return self._items[item_id]

    def list(self, state: str | None = None, kind: str | None = None) -> list[WorkItem]:
        return [
            i for i in self._items.values()
            if (state is None or i.state == state) and (kind is None or i.kind == kind)
        ]

    def comment(self, item_id: str, body: str, author: str) -> None:
        item = self.get(item_id)  # real: self._api("commentCreate", ...)
        item.comments.append(Comment(author=author, body=body))

    def comments(self, item_id: str) -> list[Comment]:
        return self.get(item_id).comments

    def transition(self, item_id: str, to_state: str, actor: Actor) -> None:
        item = self.get(item_id)
        check_transition(item.state, to_state, actor, kind=item.kind)  # NEVER skip this
        self._items[item_id] = replace(item, state=to_state)  # real: issueUpdate state

    def claim(self, item_id: str, agent_name: str) -> bool:
        item = self.get(item_id)
        if item.claimed_by:
            return item.claimed_by == agent_name
        self._items[item_id] = replace(item, claimed_by=agent_name)
        return True

    def release(self, item_id: str, agent_name: str) -> None:
        item = self.get(item_id)
        if item.claimed_by == agent_name:
            self._items[item_id] = replace(item, claimed_by="")
