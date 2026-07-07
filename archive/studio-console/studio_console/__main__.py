"""Entry point: live dashboard, fixture replay, or headless --check."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from studio_console.replay import check


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="studio-console", description=__doc__)
    parser.add_argument("--config", type=Path, default=Path("config.yaml"))
    parser.add_argument("--replay", type=Path, metavar="EVENTS_FILE",
                        help="replay a recorded stream instead of watching live")
    parser.add_argument("--speed", type=float, default=10.0, help="replay speed multiplier")
    parser.add_argument("--check", action="store_true",
                        help="headless: parse events, fold state, print a summary, exit 0/1")
    parser.add_argument("--events", type=Path,
                        help="events file for --check (default: the configured studio's)")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

    if args.check:
        events = args.events
        if events is None:
            from studio_console.config import load_config

            events = load_config(args.config).events_path
        if not Path(events).is_file():
            print(f"no events file at {events}", file=sys.stderr)
            return 1
        summary, ok = check(events)
        print(summary)
        return 0 if ok else 1

    from studio_console.app import ConsoleApp

    app = ConsoleApp(config_path=args.config, replay_path=args.replay, speed=args.speed)
    app.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
