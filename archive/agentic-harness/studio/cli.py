"""`python -m studio` — the human's console for the studio.

Commands: init, new, approve, run, status, demo.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from studio.config import ConfigError, StudioConfig, load_config

DEFAULT_CONFIG = Path("config/studio.yaml")


def _load(args: argparse.Namespace) -> StudioConfig:
    return load_config(args.config)


def cmd_init(args: argparse.Namespace) -> int:
    cfg = _load(args)
    for role_dir in (cfg.root / "memory").glob("*"):
        journal = role_dir / "journal.md"
        if role_dir.is_dir() and not journal.exists():
            journal.write_text(f"# {role_dir.name} journal\n")
    if cfg.tracker.kind == "markdown":
        (cfg.root / cfg.tracker.root / "items").mkdir(parents=True, exist_ok=True)
    print(f"config OK: {len(cfg.agents)} agents, tracker={cfg.tracker.kind}")
    for name, agent in sorted(cfg.agents.items()):
        print(f"  {name}: runtime={agent.runtime} handles={agent.handles}")
    return 0


def cmd_placeholder(args: argparse.Namespace) -> int:
    print(f"{args.command}: implemented in a later milestone", file=sys.stderr)
    return 2


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="studio", description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG, help="path to studio.yaml")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="validate config and create scaffolding")

    p_new = sub.add_parser("new", help="file a new work item")
    p_new.add_argument("title")
    p_new.add_argument("--kind", choices=["feature", "bug", "chore"], default="feature")
    p_new.add_argument("--body", default="")

    p_approve = sub.add_parser("approve", help="human gate: approve a PRD or design")
    p_approve.add_argument("item_id")

    p_run = sub.add_parser("run", help="run the orchestrator")
    mode = p_run.add_mutually_exclusive_group()
    mode.add_argument("--once", action="store_true", help="single tick")
    mode.add_argument("--watch", action="store_true", help="poll forever")
    p_run.add_argument("--dry-run", action="store_true", help="print what would dispatch")

    sub.add_parser("status", help="render the board")
    sub.add_parser("demo", help="run the end-to-end demo")
    return parser


HANDLERS = {
    "init": cmd_init,
    "new": cmd_placeholder,
    "approve": cmd_placeholder,
    "run": cmd_placeholder,
    "status": cmd_placeholder,
    "demo": cmd_placeholder,
}


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return HANDLERS[args.command](args)
    except ConfigError as exc:
        print(f"config error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
