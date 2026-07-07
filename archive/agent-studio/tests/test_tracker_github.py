"""GitHubIssuesTracker: correct gh argv construction via the FakeExecutor."""

import json

import pytest

from studio.execution import FakeExecutor
from studio.state import Actor, NotAllowedForActor
from studio.tracker.base import TrackerError
from studio.tracker.github import GitHubIssuesTracker


@pytest.fixture
def executor():
    return FakeExecutor()


@pytest.fixture
def tracker(executor):
    return GitHubIssuesTracker("jorge/app", executor)


def _issue_json(number=7, state="ready", kind="feature", claimed=""):
    labels = [{"name": f"studio:{state}"}, {"name": f"kind:{kind}"}]
    if claimed:
        labels.append({"name": f"claimed-by:{claimed}"})
    return json.dumps(
        {
            "number": number,
            "title": "Add login",
            "body": "the body",
            "labels": labels,
            "url": f"https://github.com/jorge/app/issues/{number}",
            "createdAt": "2026-07-06T00:00:00Z",
            "updatedAt": "2026-07-06T00:00:00Z",
        }
    )


def test_create_builds_argv_and_parses_id(tracker, executor):
    executor.queue(stdout="https://github.com/jorge/app/issues/12\n")
    item = tracker.create("Add login", "body", "backlog", kind="bug")
    assert item.id == "12"
    argv = executor.calls[0]
    assert argv[:3] == ("gh", "issue", "create")
    assert "--label" in argv and "studio:backlog,kind:bug" in argv
    assert argv[-2:] == ("--repo", "jorge/app")


def test_get_parses_labels_into_state_kind_claim(tracker, executor):
    executor.queue(stdout=_issue_json(state="coding", kind="bug", claimed="coder"))
    item = tracker.get("7")
    assert (item.state, item.kind, item.claimed_by) == ("coding", "bug", "coder")
    assert executor.calls[0][:4] == ("gh", "issue", "view", "7")


def test_list_filters_by_state_label(tracker, executor):
    executor.queue(stdout="[" + _issue_json() + "]")
    items = tracker.list(state="ready")
    assert len(items) == 1
    argv = executor.calls[0]
    assert ("--label", "studio:ready") == tuple(argv[argv.index("--label") : argv.index("--label") + 2])


def test_transition_swaps_labels(tracker, executor):
    executor.queue(stdout=_issue_json(state="prd:review"))  # get
    executor.queue()  # edit
    tracker.transition("7", "prd:approved", Actor.HUMAN)
    edit = executor.calls[1]
    assert ("--remove-label", "studio:prd:review") in tuple(zip(edit, edit[1:]))
    assert ("--add-label", "studio:prd:approved") in tuple(zip(edit, edit[1:]))


def test_transition_enforces_actor(tracker, executor):
    executor.queue(stdout=_issue_json(state="prd:review"))
    with pytest.raises(NotAllowedForActor):
        tracker.transition("7", "prd:approved", Actor.AGENT)
    assert len(executor.calls) == 1  # no edit issued


def test_claim_respects_existing_holder(tracker, executor):
    executor.queue(stdout=_issue_json(claimed="reviewer-a"))
    assert tracker.claim("7", "reviewer-b") is False
    executor.queue(stdout=_issue_json(claimed=""))
    executor.queue()  # edit --add-label
    assert tracker.claim("7", "reviewer-b") is True
    assert ("--add-label", "claimed-by:reviewer-b") in tuple(
        zip(executor.calls[-1], executor.calls[-1][1:])
    )


def test_comment_wraps_author(tracker, executor):
    executor.queue()
    tracker.comment("7", "Looks good", author="reviewer-a")
    argv = executor.calls[0]
    body = argv[argv.index("--body") + 1]
    assert body.startswith("**[reviewer-a]**")


def test_comments_recover_author(tracker, executor):
    executor.queue(
        stdout=json.dumps(
            {
                "comments": [
                    {"body": "**[prd]**\n\nThe PRD text", "author": {"login": "bot"}},
                    {"body": "plain human comment", "author": {"login": "jorgeper"}},
                ]
            }
        )
    )
    comments = tracker.comments("7")
    assert (comments[0].author, comments[0].body) == ("prd", "The PRD text")
    assert (comments[1].author, comments[1].body) == ("jorgeper", "plain human comment")


def test_gh_failure_raises(tracker, executor):
    executor.queue(stderr="boom", returncode=1)
    with pytest.raises(TrackerError, match="gh issue view failed"):
        tracker.get("7")
