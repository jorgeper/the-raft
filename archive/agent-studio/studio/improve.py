"""The improvement pipeline's plain-code half (self-improve-spec §6–§7).

Proposal parsing (R18), the path allowlist (R19) — enforced HERE, in harness
code, not in the improver's prompt — and the append-only improvements log.
The improver agent only ever produces text; every consequence of that text is
validated and applied by this module and the orchestrator/CLI.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

# The ONLY paths an improvement diff may touch (R19). The classic prompts,
# AGENTS.md, studio source, settings, and hooks are never in reach.
ALLOWLIST: tuple[str, ...] = ("prompts/evolving/", ".claude/skills/prompt-audit/")

_DIFF_FENCE_RE = re.compile(r"```diff\n(.*?)```", re.DOTALL)
_EXPECT_RE = re.compile(
    r"^EXPECT:\s*([\w-]+)\.([\w-]+)\s+(decrease|increase)\s*$", re.MULTILINE
)
_DIFF_PATH_RE = re.compile(r"^(?:---|\+\+\+)\s+(?:a/|b/)(\S+)", re.MULTILINE)


class ImproveError(Exception):
    """A proposal that must not proceed: malformed contract or forbidden path."""


@dataclass(frozen=True)
class Proposal:
    rationale: str
    diff: str
    expect_agent: str
    expect_metric: str
    expect_direction: str  # "decrease" | "increase"

    @property
    def expect(self) -> str:
        return f"{self.expect_agent}.{self.expect_metric} {self.expect_direction}"


def parse_proposal(output: str) -> Proposal:
    """Parse the improver's output contract (R18): rationale, exactly one
    fenced ```diff block, and a final EXPECT: <agent>.<metric> <direction> line."""
    blocks = _DIFF_FENCE_RE.findall(output or "")
    if not blocks:
        raise ImproveError("no fenced ```diff block found in the proposal")
    if len(blocks) > 1:
        raise ImproveError(f"expected exactly one ```diff block, found {len(blocks)}")
    rationale = (output or "").split("```diff", 1)[0].strip()
    if not rationale:
        raise ImproveError("proposal has no rationale before the diff block")
    expects = _EXPECT_RE.findall(output)
    if not expects:
        raise ImproveError(
            "missing or malformed final line `EXPECT: <agent>.<metric> <decrease|increase>`"
        )
    agent, metric, direction = expects[-1]
    return Proposal(
        rationale=rationale,
        diff=blocks[0],
        expect_agent=agent,
        expect_metric=metric,
        expect_direction=direction,
    )


def diff_paths(diff: str) -> set[str]:
    """Every repo-relative path a unified diff touches (both sides, /dev/null excluded)."""
    return set(_DIFF_PATH_RE.findall(diff or ""))


def validate_paths(paths: set[str]) -> None:
    """R19/R21: every touched path must be under the allowlist; raise naming the
    first offender otherwise. Rejects traversal out of the allowed trees."""
    for path in sorted(paths):
        normalized = str(Path(path).as_posix())
        if ".." in Path(path).parts or Path(path).is_absolute():
            raise ImproveError(f"diff touches a non-relative path: {path}")
        if not normalized.startswith(ALLOWLIST):
            raise ImproveError(
                f"diff touches {path!r}, outside the allowlist "
                f"({', '.join(ALLOWLIST)})"
            )


def latest_proposal(item) -> Proposal:
    """The most recent comment carrying a ```diff block, parsed as a proposal."""
    for comment in reversed(item.comments):
        if "```diff" in comment.body:
            return parse_proposal(comment.body)
    raise ImproveError("no proposal comment with a ```diff block found on the item")


def metric_value(card: dict, agent: str, metric: str) -> float | None:
    return (card.get("agents", {}).get(agent) or {}).get(metric)


def apply_improvement(cfg, tracker, item, *, executor, registry) -> dict:
    """R21: validate -> git apply --check -> apply -> commit ONLY the proposal's
    files -> regenerate subagents -> record a watching entry. Raises ImproveError
    (nothing written) on any refusal; the caller routes the item to needs-human."""
    from studio.metrics import compute_scorecard, read_events

    proposal = latest_proposal(item)
    paths = diff_paths(proposal.diff)
    validate_paths(paths)  # apply-time re-check; drafting-time validation is not trusted
    root = str(cfg.root)
    ordered = sorted(paths)

    check = executor.run(["git", "-C", root, "apply", "--check"], input_text=proposal.diff)
    if not check.ok:
        raise ImproveError(f"git apply --check failed: {(check.stderr or check.stdout).strip()}")
    applied = executor.run(["git", "-C", root, "apply"], input_text=proposal.diff)
    if not applied.ok:
        raise ImproveError(f"git apply failed: {(applied.stderr or applied.stdout).strip()}")

    first_line = proposal.rationale.splitlines()[0][:72]
    message = f"improve({cfg.active_set}): item {item.id} — {first_line}"
    executor.run(["git", "-C", root, "add", "--", *ordered])
    commit = executor.run(["git", "-C", root, "commit", "-m", message, "--", *ordered])
    if not commit.ok:
        raise ImproveError(f"git commit failed: {(commit.stderr or commit.stdout).strip()}")
    sha = executor.run(["git", "-C", root, "rev-parse", "HEAD"]).stdout.strip()

    registry.generate_subagent_files()
    card = compute_scorecard(read_events(cfg.root / ".agent-logs" / "events.jsonl"))
    record = {
        "event": "applied",
        "item": item.id,
        "set": cfg.active_set,
        "files": ordered,
        "expect": proposal.expect,
        "baseline": metric_value(card, proposal.expect_agent, proposal.expect_metric),
        "sha": sha,
        "status": "watching",
    }
    ImprovementsLog(cfg.root / "memory" / "improvements.jsonl").append(record)
    return record


class ImprovementsLog:
    """Append-only JSONL log at memory/improvements.jsonl.

    Record kinds (by `event`): `filed` (trigger created an improvement item),
    `applied` (human-approved diff committed), `status` (regression-guard
    updates: watching -> kept | reverted | rejected).
    """

    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    def entries(self) -> list[dict]:
        if not self.path.is_file():
            return []
        out = []
        for line in self.path.read_text().splitlines():
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return out

    def append(self, record: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        record = {"ts": datetime.now(UTC).isoformat(timespec="seconds"), **record}
        with self.path.open("a") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")

    def consumed_done_ids(self) -> set[str]:
        """Done-item ids already covered by a previously filed improvement (R17)."""
        covered: set[str] = set()
        for entry in self.entries():
            if entry.get("event") == "filed":
                covered.update(entry.get("covers", ()))
        return covered

    def current_status(self, item_id: str) -> str | None:
        """Effective status of an applied improvement: last status record wins."""
        status = None
        for entry in self.entries():
            if entry.get("item") == item_id:
                if entry.get("event") == "applied":
                    status = entry.get("status", "watching")
                elif entry.get("event") == "status":
                    status = entry.get("status")
        return status
