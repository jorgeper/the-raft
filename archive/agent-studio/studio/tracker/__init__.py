"""Tracker factory."""

from __future__ import annotations

from studio.config import StudioConfig
from studio.execution import CommandExecutor
from studio.tracker.base import Comment, Tracker, TrackerError, WorkItem
from studio.tracker.github import GitHubIssuesTracker
from studio.tracker.markdown import MarkdownTracker

__all__ = [
    "Comment",
    "GitHubIssuesTracker",
    "MarkdownTracker",
    "Tracker",
    "TrackerError",
    "WorkItem",
    "make_tracker",
]


def make_tracker(cfg: StudioConfig, executor: CommandExecutor | None = None) -> Tracker:
    if cfg.tracker.kind == "markdown":
        return MarkdownTracker(cfg.root / cfg.tracker.root)
    return GitHubIssuesTracker(cfg.tracker.repo, executor or CommandExecutor())
