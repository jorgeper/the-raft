"""Tracker: the work queue and state-machine store, outside the agents."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from studio.state import Actor


@dataclass(frozen=True)
class Comment:
    author: str
    body: str


@dataclass
class WorkItem:
    id: str
    title: str
    body: str
    state: str
    kind: str = "feature"
    claimed_by: str = ""
    url: str = ""
    created: str = ""
    updated: str = ""
    comments: list[Comment] = field(default_factory=list)


class TrackerError(Exception):
    pass


class Tracker(ABC):
    @abstractmethod
    def create(self, title: str, body: str, state: str, kind: str = "feature") -> WorkItem: ...

    @abstractmethod
    def get(self, item_id: str) -> WorkItem: ...

    @abstractmethod
    def list(self, state: str | None = None, kind: str | None = None) -> list[WorkItem]: ...

    @abstractmethod
    def comment(self, item_id: str, body: str, author: str) -> None: ...

    @abstractmethod
    def comments(self, item_id: str) -> list[Comment]: ...

    @abstractmethod
    def transition(self, item_id: str, to_state: str, actor: Actor) -> None:
        """Validated move; raises studio.state.TransitionError on refusal."""

    @abstractmethod
    def claim(self, item_id: str, agent_name: str) -> bool:
        """Single-flight lock. True if this agent now holds the item."""

    @abstractmethod
    def release(self, item_id: str, agent_name: str) -> None:
        """Drop a claim so the item can be dispatched again later."""
