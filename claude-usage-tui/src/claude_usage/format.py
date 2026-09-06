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


def fmt_countdown(delta_seconds: float) -> str:
    """'2h 10m', '1d 3h 5m', or 'now' once the moment has passed."""
    secs = int(delta_seconds)
    if secs <= 0:
        return "now"
    days, rem = divmod(secs, 86400)
    hours, rem = divmod(rem, 3600)
    minutes = rem // 60
    if days:
        return f"{days}d {hours}h {minutes}m"
    return f"{hours}h {minutes}m"


def fmt_when(moment: datetime, now: datetime | None = None) -> str:
    """Local weekday + clock, then how far away it is: 'Sat 23:49 (in 2h 10m)'."""
    now = now or datetime.now(timezone.utc)
    countdown = fmt_countdown((moment - now).total_seconds())
    tail = "now" if countdown == "now" else f"in {countdown}"
    return f"{moment.astimezone():%a %H:%M} ({tail})"


def fmt_delta(until: datetime | None, now: datetime | None = None) -> str:
    if until is None:
        return ""
    now = now or datetime.now(timezone.utc)
    if (until - now).total_seconds() <= 0:
        return "resetting…"
    return f"resets {fmt_when(until, now=now)}"


def bar(percent: float, width: int = 40) -> Text:
    percent = max(0.0, min(100.0, percent))
    filled = round(width * percent / 100)
    color = GRUVBOX["green"] if percent < 60 else GRUVBOX["yellow"] if percent < 85 else GRUVBOX["red"]
    text = Text()
    text.append("█" * filled, style=color)
    text.append("░" * (width - filled), style=GRUVBOX["track"])
    text.append(f" {percent:3.0f}%", style=f"bold {color}")
    return text
