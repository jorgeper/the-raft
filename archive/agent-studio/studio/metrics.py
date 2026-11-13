"""Scorecard: per-agent metrics computed by the harness — plain code, no LLM.

Reads the events.jsonl observability stream (self-improve-spec §4). Metrics with
no data are None, never 0: zero iterations and no data are different facts.
The append-only snapshot log (memory/scorecard.jsonl) is written one line per
done item and is the baseline store for the regression guard (§7).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path


def read_events(path: Path) -> list[dict]:
    """Parse an events.jsonl file, silently skipping unparseable lines."""
    path = Path(path)
    if not path.is_file():
        return []
    events = []
    for line in path.read_text().splitlines():
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(record, dict) and record.get("kind"):
            events.append(record)
    return events


def _mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


class _ItemFacts:
    def __init__(self) -> None:
        self.changes_requested = 0
        self.reached_human_review = False
        self.redrafts: dict[str, int] = {}  # review state -> times bounced back
        self.decided: set[str] = set()  # review states that reached approved
        self.rounds: list[list[str]] = []  # per review round: verdicts in order
        self._open_round: list[str] = []

    def feed(self, kind: str, agent: str | None, data: dict) -> None:
        if kind == "transition":
            frm, to = data.get("from", ""), data.get("to", "")
            if to == "pr:changes-requested":
                self.changes_requested += 1
            if to == "pr:human-review":
                self.reached_human_review = True
            if frm.endswith(":review") and to.endswith(":drafting"):
                self.redrafts[frm] = self.redrafts.get(frm, 0) + 1
            if frm.endswith(":review") and to.endswith(":approved"):
                self.decided.add(frm)
        elif kind == "dispatch_end":
            detail = str(data.get("detail", ""))
            if detail.startswith("verdict="):
                self._open_round.append(detail.removeprefix("verdict="))
            elif agent == "review-round" and self._open_round:
                self.rounds.append(self._open_round)
                self._open_round = []


def compute_scorecard(events: list[dict], items: set[str] | None = None) -> dict:
    """Aggregate events into {"agents": {name: {metric: value|None}}}.

    `items` restricts the computation to that subset of work-item ids (R12).
    """
    facts: dict[str, _ItemFacts] = {}
    # per agent bookkeeping
    loop_exits: dict[str, list[tuple[str, str, int]]] = {}  # agent -> [(item, reason, iters)]
    dispatches: dict[str, list[tuple[str, str, str]]] = {}  # agent -> [(item, action, detail)]

    for record in events:
        item = record.get("item")
        agent = record.get("agent")
        data = record.get("data", {}) or {}
        if item is None or (items is not None and item not in items):
            continue
        facts.setdefault(item, _ItemFacts()).feed(record["kind"], agent, data)
        if record["kind"] == "loop_exit" and agent:
            loop_exits.setdefault(agent, []).append(
                (item, str(data.get("reason", "")), int(data.get("iterations", 0)))
            )
        elif record["kind"] == "dispatch_end" and agent and agent != "review-round":
            if data.get("action") in ("dispatched", "escalated", "failed"):
                dispatches.setdefault(agent, []).append(
                    (item, str(data.get("action")), str(data.get("detail", "")))
                )

    agents: dict[str, dict[str, float | None]] = {}

    for agent, exits in loop_exits.items():
        card = agents.setdefault(agent, {})
        card["iterations_per_verified"] = _mean(
            [float(i) for _, reason, i in exits if reason == "verified"]
        )
        runs = dispatches.get(agent, [])
        card["escalation_rate"] = (
            sum(1 for _, action, _ in runs if action == "escalated") / len(runs) if runs else None
        )
        worked = {item for item, _, _ in exits}
        card["review_rounds_per_item"] = _mean(
            [float(facts[i].changes_requested) for i in worked if i in facts]
        )

    for agent, runs in dispatches.items():
        verdict_items = {item for item, _, detail in runs if detail.startswith("verdict=")}
        if verdict_items:
            card = agents.setdefault(agent, {})
            card["rounds_until_approve"] = _mean(
                [
                    float(sum(1 for i, _, d in runs if i == item and d.startswith("verdict=")))
                    for item in verdict_items
                    if facts[item].reached_human_review
                ]
            )
            rounds = [r for item in verdict_items for r in facts[item].rounds]
            card["disagreement_rate"] = (
                sum(1 for r in rounds if len(set(r)) > 1) / len(rounds) if rounds else None
            )
        review_states = {
            detail.removeprefix("-> ")
            for _, _, detail in runs
            if detail.startswith("-> ") and detail.endswith(":review")
        }
        for review_state in review_states:
            card = agents.setdefault(agent, {})
            decided = [
                item
                for item, _, detail in runs
                if detail == f"-> {review_state}" and review_state in facts[item].decided
            ]
            card["first_pass_approval_rate"] = (
                _mean(
                    [
                        1.0 if facts[item].redrafts.get(review_state, 0) == 0 else 0.0
                        for item in set(decided)
                    ]
                )
                if decided
                else None
            )

    # Agents seen only in failed/other dispatches still get a (null) card.
    for agent in dispatches:
        agents.setdefault(agent, {}).setdefault("iterations_per_verified", None)

    return {"agents": agents}


class ScorecardLog:
    """Append-only JSONL of per-item scorecard snapshots (memory/scorecard.jsonl)."""

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

    def recorded_ids(self) -> set[str]:
        return {e["item"] for e in self.entries() if "item" in e}

    def append(self, item_id: str, *, set_name: str, kind: str, agents: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "ts": datetime.now(UTC).isoformat(timespec="seconds"),
            "item": item_id,
            "set": set_name,
            "kind": kind,
            "agents": agents,
        }
        with self.path.open("a") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
