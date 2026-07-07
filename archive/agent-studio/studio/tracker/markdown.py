"""MarkdownTracker: work items as human-readable files under .work/.

One file per item (YAML frontmatter + body + comment blocks), plus a regenerated
board.md kanban view. This is the offline / testing / demo tracker.
"""

from __future__ import annotations

import os
from datetime import UTC, datetime
from pathlib import Path

import yaml

from studio.events import NullEventLog
from studio.state import KINDS, STATES, Actor, check_transition
from studio.tracker.base import Comment, Tracker, TrackerError, WorkItem

_COMMENT_MARK = '<!-- comment author="{author}" -->'

# Board rendering order — the pipeline, then the parking states.
BOARD_ORDER = [
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
]


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


class MarkdownTracker(Tracker):
    def __init__(self, root: Path, events=None) -> None:
        self.root = Path(root)
        self.items_dir = self.root / "items"
        self.items_dir.mkdir(parents=True, exist_ok=True)
        self.events = events or NullEventLog()

    # -- storage ---------------------------------------------------------

    def _path(self, item_id: str) -> Path:
        return self.items_dir / f"{item_id}.md"

    def _next_id(self) -> str:
        taken = [int(p.stem) for p in self.items_dir.glob("*.md") if p.stem.isdigit()]
        return str(max(taken, default=0) + 1)

    def _write(self, item: WorkItem) -> None:
        front = {
            "title": item.title,
            "state": item.state,
            "kind": item.kind,
            "claimed_by": item.claimed_by,
            "created": item.created,
            "updated": item.updated,
        }
        parts = ["---\n" + yaml.safe_dump(front, sort_keys=False) + "---\n\n" + item.body.rstrip() + "\n"]
        for c in item.comments:
            parts.append("\n" + _COMMENT_MARK.format(author=c.author) + "\n" + c.body.rstrip() + "\n")
        tmp = self._path(item.id).with_suffix(".tmp")
        tmp.write_text("".join(parts))
        os.replace(tmp, self._path(item.id))
        self._render_board()

    def _read(self, item_id: str) -> WorkItem:
        path = self._path(item_id)
        if not path.is_file():
            raise TrackerError(f"no such item: {item_id}")
        text = path.read_text()
        try:
            _, front_raw, rest = text.split("---\n", 2)
        except ValueError as exc:
            raise TrackerError(f"malformed item file: {path}") from exc
        front = yaml.safe_load(front_raw)
        chunks = rest.split("<!-- comment author=")
        body = chunks[0].strip()
        comments = []
        for chunk in chunks[1:]:
            author, _, comment_body = chunk.partition(" -->")
            comments.append(Comment(author=author.strip('"'), body=comment_body.strip()))
        return WorkItem(
            id=item_id,
            title=front["title"],
            body=body,
            state=front["state"],
            kind=front.get("kind", "feature"),
            claimed_by=front.get("claimed_by", "") or "",
            url=str(path),
            created=front.get("created", ""),
            updated=front.get("updated", ""),
            comments=comments,
        )

    # -- Tracker API -----------------------------------------------------

    def create(self, title: str, body: str, state: str, kind: str = "feature") -> WorkItem:
        if state not in STATES:
            raise TrackerError(f"unknown state: {state}")
        if kind not in KINDS:
            raise TrackerError(f"unknown kind: {kind}")
        item = WorkItem(
            id=self._next_id(),
            title=title,
            body=body,
            state=state,
            kind=kind,
            created=_now(),
            updated=_now(),
        )
        self._write(item)
        self.events.emit("item_created", item=item.id, title=title, kind=kind, state=state)
        return self._read(item.id)

    def get(self, item_id: str) -> WorkItem:
        return self._read(item_id)

    def list(self, state: str | None = None, kind: str | None = None) -> list[WorkItem]:
        items = sorted(
            (self._read(p.stem) for p in self.items_dir.glob("*.md")),
            key=lambda i: int(i.id) if i.id.isdigit() else 0,
        )
        return [
            i
            for i in items
            if (state is None or i.state == state) and (kind is None or i.kind == kind)
        ]

    def comment(self, item_id: str, body: str, author: str) -> None:
        item = self._read(item_id)
        item.comments.append(Comment(author=author, body=body))
        item.updated = _now()
        self._write(item)
        self.events.emit(
            "comment_added", item=item_id, author=author, chars=len(body), comment_tail=body
        )

    def comments(self, item_id: str) -> list[Comment]:
        return self._read(item_id).comments

    def transition(self, item_id: str, to_state: str, actor: Actor) -> None:
        item = self._read(item_id)
        check_transition(item.state, to_state, actor, kind=item.kind)
        from_state = item.state
        item.state = to_state
        item.updated = _now()
        self._write(item)
        self.events.emit(
            "transition", item=item_id,
            **{"from": from_state, "to": to_state, "actor": actor.value},
        )

    def claim(self, item_id: str, agent_name: str) -> bool:
        lock = self.items_dir / f"{item_id}.claim"
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            return lock.read_text() == agent_name  # idempotent re-claim by the holder
        with os.fdopen(fd, "w") as fh:
            fh.write(agent_name)
        item = self._read(item_id)
        item.claimed_by = agent_name
        self._write(item)
        self.events.emit("claimed", item=item_id, agent=agent_name)
        return True

    def release(self, item_id: str, agent_name: str) -> None:
        lock = self.items_dir / f"{item_id}.claim"
        if lock.is_file() and lock.read_text() == agent_name:
            lock.unlink()
            item = self._read(item_id)
            item.claimed_by = ""
            self._write(item)
            self.events.emit("released", item=item_id, agent=agent_name)

    # -- board -------------------------------------------------------------

    def _render_board(self) -> None:
        lines = [f"# Board — updated {_now()}", ""]
        items = self.list()
        for state in BOARD_ORDER:
            in_state = [i for i in items if i.state == state]
            if not in_state:
                continue
            lines.append(f"## {state}")
            for i in in_state:
                claimed = f" (claimed by {i.claimed_by})" if i.claimed_by else ""
                lines.append(f"- #{i.id} {i.title} [{i.kind}]{claimed}")
            lines.append("")
        tmp = self.root / "board.tmp"
        tmp.write_text("\n".join(lines) + "\n")
        os.replace(tmp, self.root / "board.md")
