"""GitHubIssuesTracker: labels are states (`studio:<state>`), all via the `gh` CLI
through the injected CommandExecutor — never the GitHub API directly.
"""

from __future__ import annotations

import json

from studio.execution import CommandExecutor
from studio.state import STATES, Actor, check_transition
from studio.tracker.base import Comment, Tracker, TrackerError, WorkItem

_ITEM_FIELDS = "number,title,body,labels,url,createdAt,updatedAt"


def state_label(state: str) -> str:
    return f"studio:{state}"


def kind_label(kind: str) -> str:
    return f"kind:{kind}"


def claim_label(agent: str) -> str:
    return f"claimed-by:{agent}"


class GitHubIssuesTracker(Tracker):
    def __init__(self, repo: str, executor: CommandExecutor) -> None:
        self.repo = repo
        self.executor = executor

    def _gh(self, *args: str, input_text: str | None = None) -> str:
        result = self.executor.run(["gh", *args, "--repo", self.repo], input_text=input_text)
        if not result.ok:
            raise TrackerError(f"gh {' '.join(args[:2])} failed: {result.stderr.strip()}")
        return result.stdout

    @staticmethod
    def _parse(raw: dict) -> WorkItem:
        labels = [label["name"] for label in raw.get("labels", [])]
        state = next((n.split(":", 1)[1] for n in labels if n.startswith("studio:")), "backlog")
        kind = next((n.split(":", 1)[1] for n in labels if n.startswith("kind:")), "feature")
        claimed = next((n.split(":", 1)[1] for n in labels if n.startswith("claimed-by:")), "")
        return WorkItem(
            id=str(raw["number"]),
            title=raw.get("title", ""),
            body=raw.get("body", "") or "",
            state=state,
            kind=kind,
            claimed_by=claimed,
            url=raw.get("url", ""),
            created=raw.get("createdAt", ""),
            updated=raw.get("updatedAt", ""),
        )

    # -- Tracker API -----------------------------------------------------

    def create(self, title: str, body: str, state: str, kind: str = "feature") -> WorkItem:
        if state not in STATES:
            raise TrackerError(f"unknown state: {state}")
        out = self._gh(
            "issue", "create",
            "--title", title,
            "--body", body,
            "--label", f"{state_label(state)},{kind_label(kind)}",
        )
        item_id = out.strip().rstrip("/").rsplit("/", 1)[-1]
        return WorkItem(id=item_id, title=title, body=body, state=state, kind=kind, url=out.strip())

    def get(self, item_id: str) -> WorkItem:
        out = self._gh("issue", "view", item_id, "--json", _ITEM_FIELDS)
        return self._parse(json.loads(out))

    def list(self, state: str | None = None, kind: str | None = None) -> list[WorkItem]:
        args = ["issue", "list", "--state", "open", "--json", _ITEM_FIELDS, "--limit", "200"]
        if state is not None:
            args += ["--label", state_label(state)]
        out = self._gh(*args)
        items = [self._parse(raw) for raw in json.loads(out)]
        return [i for i in items if kind is None or i.kind == kind]

    def comment(self, item_id: str, body: str, author: str) -> None:
        self._gh("issue", "comment", item_id, "--body", f"**[{author}]**\n\n{body}")

    def comments(self, item_id: str) -> list[Comment]:
        out = self._gh("issue", "view", item_id, "--json", "comments")
        raw = json.loads(out).get("comments", [])
        result = []
        for c in raw:
            body = c.get("body", "")
            author = c.get("author", {}).get("login", "unknown")
            # Recover the studio role from our own comment convention.
            if body.startswith("**[") and "]**" in body:
                author, _, body = body[3:].partition("]**")
                body = body.strip()
            result.append(Comment(author=author, body=body))
        return result

    def transition(self, item_id: str, to_state: str, actor: Actor) -> None:
        item = self.get(item_id)
        check_transition(item.state, to_state, actor, kind=item.kind)
        self._gh(
            "issue", "edit", item_id,
            "--remove-label", state_label(item.state),
            "--add-label", state_label(to_state),
        )

    def claim(self, item_id: str, agent_name: str) -> bool:
        item = self.get(item_id)
        if item.claimed_by:
            return item.claimed_by == agent_name
        self._gh("issue", "edit", item_id, "--add-label", claim_label(agent_name))
        return True

    def release(self, item_id: str, agent_name: str) -> None:
        item = self.get(item_id)
        if item.claimed_by == agent_name:
            self._gh("issue", "edit", item_id, "--remove-label", claim_label(agent_name))
