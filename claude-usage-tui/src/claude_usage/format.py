"""Shared formatting helpers for the TUI panels and the --once snapshot."""

from __future__ import annotations

from datetime import datetime, timezone

from rich.text import Text

# Gruvbox (dark) accents, used in Rich renderables; the app chrome uses
# Textual's built-in "gruvbox" theme.
GRUVBOX = {
    "green": "#b8bb26",
    "yellow": "#fabd2f",
    "red": "#fb4934",
    "aqua": "#8ec07c",
    "track": "#504945",
}

KIND_LABELS = {
    "session": "Session (5h)",
    "five_hour": "Session (5h)",
    "seven_day": "Week (all models)",
    "weekly_all": "Week (all models)",
    "weekly_scoped": "Week (Opus/Fable)",
    "seven_day_opus": "Week (Opus)",
    "seven_day_sonnet": "Week (Sonnet)",
}


def limit_label(kind: str) -> str:
    return KIND_LABELS.get(kind, kind.replace("_", " ").title())


def fmt_tokens(n: int) -> str:
    if n >= 1_000_000_000:
        return f"{n / 1e9:.1f}B"
    if n >= 1_000_000:
        return f"{n / 1e6:.1f}M"
    if n >= 1_000:
        return f"{n / 1e3:.1f}K"
    return str(n)


def fmt_delta(until: datetime | None) -> str:
    if until is None:
        return ""
    secs = (until - datetime.now(timezone.utc)).total_seconds()
    if secs <= 0:
        return "resetting…"
    hours, rem = divmod(int(secs), 3600)
    if hours >= 24:
        return f"resets in {hours // 24}d {hours % 24}h"
    return f"resets in {hours}h {rem // 60}m"


def bar(percent: float, width: int = 40) -> Text:
    percent = max(0.0, min(100.0, percent))
    filled = round(width * percent / 100)
    color = GRUVBOX["green"] if percent < 60 else GRUVBOX["yellow"] if percent < 85 else GRUVBOX["red"]
    text = Text()
    text.append("█" * filled, style=color)
    text.append("░" * (width - filled), style=GRUVBOX["track"])
    text.append(f" {percent:3.0f}%", style=f"bold {color}")
    return text
