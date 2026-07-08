"""`python -m studio` — the human's console for the studio.

Commands: init, new, approve, run, status, demo.
"""

from __future__ import annotations

import argparse
import json as _json
import subprocess
import sys
from pathlib import Path

from studio.agents.registry import AgentRegistry
from studio.config import ConfigError, StudioConfig, load_config
from studio.events import EventLog
from studio.execution import CommandExecutor
from studio.orchestrator import Orchestrator
from studio.runtime import make_runtime
from studio.state import Actor, TransitionError
from studio.tracker import make_tracker
from studio.tracker.markdown import BOARD_ORDER

DEFAULT_CONFIG = Path("config/studio.yaml")

# Where the human comes in: states only `studio approve` (or a review comment) can move.
HUMAN_GATES = {"prd:review", "design:review", "pr:human-review", "needs-human"}


def _load(args: argparse.Namespace) -> StudioConfig:
    return load_config(args.config)


def _world(cfg: StudioConfig):
    executor = CommandExecutor()
    events = EventLog(cfg.root / ".agent-logs" / "events.jsonl")
    tracker = make_tracker(cfg, executor, events=events)
    registry = AgentRegistry(cfg)
    runtimes = {name: make_runtime(rc, executor) for name, rc in cfg.runtimes.items()}
    return executor, tracker, registry, runtimes, events


def cmd_init(args: argparse.Namespace) -> int:
    cfg = _load(args)
    for agent in cfg.agents.values():
        journal = cfg.root / "memory" / (agent.memory or agent.name) / "journal.md"
        journal.parent.mkdir(parents=True, exist_ok=True)
        if not journal.exists():
            journal.write_text(f"# {agent.memory or agent.name} journal\n")
    if cfg.tracker.kind == "markdown":
        (cfg.root / cfg.tracker.root / "items").mkdir(parents=True, exist_ok=True)
    registry = AgentRegistry(cfg)
    generated = registry.generate_subagent_files()
    print(f"config OK: {len(cfg.agents)} agents, tracker={cfg.tracker.kind}")
    for name, agent in sorted(cfg.agents.items()):
        runtime = make_runtime(cfg.runtimes[agent.runtime])
        mark = "ok" if runtime.available() else "MISSING CLI"
        print(f"  {name}: runtime={agent.runtime} ({mark}) handles={agent.handles}")
    print(f"generated {len(generated)} native subagent files under .claude/agents/")
    return 0


def cmd_new(args: argparse.Namespace) -> int:
    cfg = _load(args)
    _, tracker, _, _, _ = _world(cfg)
    item = tracker.create(args.title, args.body, "backlog", kind=args.kind)
    first = "design:drafting" if args.kind == "bug" else "prd:drafting"
    tracker.transition(item.id, first, Actor.HUMAN)
    print(f"created #{item.id} ({args.kind}) -> {first}")
    return 0


def cmd_approve(args: argparse.Namespace) -> int:
    cfg = _load(args)
    _, tracker, _, _, _ = _world(cfg)
    item = tracker.get(args.item_id)
    if item.state == "prd:review":
        tracker.transition(item.id, "prd:approved", Actor.HUMAN)
        tracker.transition(item.id, "design:drafting", Actor.HUMAN)
        print(f"#{item.id}: PRD approved -> design:drafting")
    elif item.state == "design:review":
        tracker.transition(item.id, "design:approved", Actor.HUMAN)
        tracker.transition(item.id, "ready", Actor.HUMAN)
        print(f"#{item.id}: design approved -> ready (a coder may claim it)")
    elif item.state == "pr:human-review":
        tracker.transition(item.id, "done", Actor.HUMAN)
        print(f"#{item.id}: done. Merge the PR yourself — agents never merge.")
    else:
        print(f"#{item.id} is in {item.state!r}; nothing here needs approval", file=sys.stderr)
        return 1
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    cfg = _load(args)
    executor, tracker, registry, runtimes, events = _world(cfg)
    orch = Orchestrator(cfg, tracker, registry, runtimes, executor=executor, events=events)
    if args.watch:
        print(f"watching every {cfg.poll_interval_s}s — Ctrl-C to stop")
        try:
            orch.watch()
        except KeyboardInterrupt:
            print("stopped")
        return 0
    dispatches = orch.tick(dry_run=args.dry_run)
    for d in dispatches:
        print(f"#{d.item_id} {d.agent}: {d.action} {d.detail}".rstrip())
    if not dispatches:
        print("idle: nothing to dispatch")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    cfg = _load(args)
    _, tracker, _, _, _ = _world(cfg)
    items = tracker.list()
    if args.json:
        from datetime import UTC, datetime

        payload = {
            "generated": datetime.now(UTC).isoformat(timespec="seconds"),
            "items": [
                {
                    "id": i.id, "title": i.title, "state": i.state, "kind": i.kind,
                    "claimed_by": i.claimed_by, "updated": i.updated, "url": i.url,
                }
                for i in items
            ],
        }
        print(_json.dumps(payload, indent=2))
        return 0
    print("Agent Studio board")
    print("==================")
    if not items:
        print("(no work items — file one with `studio new`)")
    for state in BOARD_ORDER:
        in_state = [i for i in items if i.state == state]
        if not in_state:
            continue
        print(f"\n{state}")
        for i in in_state:
            claimed = f"  [claimed: {i.claimed_by}]" if i.claimed_by else ""
            print(f"  #{i.id} {i.title} ({i.kind}){claimed}")
    needs_you = [i for i in items if i.state in HUMAN_GATES]
    print("\nNeeds you")
    print("---------")
    if needs_you:
        actions = {
            "prd:review": "read the PRD comment, then `studio approve`",
            "design:review": "read the design comment, then `studio approve`",
            "pr:human-review": "read the PR + review history, merge, then `studio approve`",
            "needs-human": "read the escalation comment and re-route",
        }
        for i in needs_you:
            print(f"  #{i.id} {i.title} — {actions[i.state]}")
    else:
        print("  nothing — the agents have it covered")
    return 0


def cmd_show(args: argparse.Namespace) -> int:
    cfg = _load(args)
    _, tracker, _, _, _ = _world(cfg)
    item = tracker.get(args.item_id)
    if args.json:
        payload = {
            "id": item.id, "title": item.title, "body": item.body, "state": item.state,
            "kind": item.kind, "claimed_by": item.claimed_by, "updated": item.updated,
            "url": item.url,
            "comments": [{"author": c.author, "body": c.body} for c in item.comments],
        }
        print(_json.dumps(payload, indent=2))
        return 0
    print(f"#{item.id} {item.title} [{item.kind}] — {item.state}")
    print(f"claimed: {item.claimed_by or '-'} | updated: {item.updated}")
    print(f"\n{item.body}\n")
    for c in item.comments:
        print(f"--- {c.author} ---\n{c.body}\n")
    return 0


def cmd_improve(args: argparse.Namespace) -> int:
    cfg = _load(args)
    executor, tracker, registry, runtimes, events = _world(cfg)
    orch = Orchestrator(cfg, tracker, registry, runtimes, executor=executor, events=events)
    item = orch.maybe_file_improvement(force=True)
    if item is None:
        print(
            "no improvement item filed — either one is already open (single-flight) "
            "or the active set has no improver agent",
            file=sys.stderr,
        )
        return 1
    print(f"filed improvement item #{item.id} (improve:drafting) — next tick dispatches the improver")
    return 0


def cmd_scorecard(args: argparse.Namespace) -> int:
    from studio.metrics import ScorecardLog, compute_scorecard, read_events

    cfg = _load(args)
    events_path = args.events or (cfg.root / ".agent-logs" / "events.jsonl")
    items = None
    if args.set:
        log = ScorecardLog(cfg.root / "memory" / "scorecard.jsonl")
        items = {e["item"] for e in log.entries() if e.get("set") == args.set}
    card = compute_scorecard(read_events(events_path), items=items)
    if args.json:
        print(_json.dumps(card, indent=2))
        return 0
    print("Scorecard" + (f" — set: {args.set}" if args.set else ""))
    print("=========")
    if not card["agents"]:
        print("(no events yet — metrics appear once agents have run)")
        return 0
    for agent, metrics in sorted(card["agents"].items()):
        rendered = ", ".join(
            f"{name}={'-' if value is None else round(value, 3)}"
            for name, value in sorted(metrics.items())
        )
        print(f"  {agent}: {rendered}")
    return 0


def cmd_demo(args: argparse.Namespace) -> int:
    script = Path(__file__).resolve().parent.parent / "scripts" / "demo.sh"
    return subprocess.run([str(script)]).returncode


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="studio", description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG, help="path to studio.yaml")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="validate config, create scaffolding, generate subagents")

    p_new = sub.add_parser("new", help="file a new work item")
    p_new.add_argument("title")
    p_new.add_argument("--kind", choices=["feature", "bug", "chore"], default="feature")
    p_new.add_argument("--body", default="")

    p_approve = sub.add_parser("approve", help="human gate: approve a PRD, design, or PR")
    p_approve.add_argument("item_id")

    p_run = sub.add_parser("run", help="run the orchestrator")
    mode = p_run.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="single tick (default)")
    mode.add_argument("--watch", action="store_true", help="poll forever")
    p_run.add_argument("--dry-run", action="store_true", help="print what would dispatch")

    p_status = sub.add_parser("status", help="render the board")
    p_status.add_argument("--json", action="store_true", help="machine-readable snapshot")

    p_show = sub.add_parser("show", help="show one work item with its comments")
    p_show.add_argument("item_id")
    p_show.add_argument("--json", action="store_true", help="machine-readable item")

    sub.add_parser("improve", help="file an improvement item now (subject to single-flight)")

    p_score = sub.add_parser("scorecard", help="per-agent metrics computed from events.jsonl")
    p_score.add_argument("--json", action="store_true", help="machine-readable scorecard")
    p_score.add_argument("--set", default="", help="restrict to items done under this agent set")
    p_score.add_argument("--events", type=Path, default=None, help="events.jsonl to read (default: .agent-logs/)")

    sub.add_parser("demo", help="run the end-to-end demo")
    return parser


HANDLERS = {
    "init": cmd_init,
    "new": cmd_new,
    "approve": cmd_approve,
    "run": cmd_run,
    "status": cmd_status,
    "show": cmd_show,
    "scorecard": cmd_scorecard,
    "improve": cmd_improve,
    "demo": cmd_demo,
}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return HANDLERS[args.command](args)
    except ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 1
    except TransitionError as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
