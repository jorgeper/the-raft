"""Tracker factory."""

from __future__ import annotations

from blacksun.config import BlackSunConfig
from blacksun.execution import CommandExecutor
from blacksun.tracker.base import Comment, Tracker, TrackerError, WorkItem
from blacksun.tracker.github import GitHubIssuesTracker
from blacksun.tracker.markdown import MarkdownTracker

__all__ = [
    "Comment",
    "GitHubIssuesTracker",
    "MarkdownTracker",
    "Tracker",
    "TrackerError",
    "WorkItem",
    "make_tracker",
]


def make_tracker(
    cfg: BlackSunConfig, executor: CommandExecutor | None = None, events=None
) -> Tracker:
    if cfg.tracker.kind == "markdown":
        return MarkdownTracker(cfg.root / cfg.tracker.root, events=events)
    return GitHubIssuesTracker(cfg.tracker.repo, executor or CommandExecutor(), events=events)
