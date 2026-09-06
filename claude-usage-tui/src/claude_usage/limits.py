"""Rate-limit meters: parse the OAuth usage endpoint payload, fetch it live."""

from __future__ import annotations

import json
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime

USAGE_URL = "https://api.anthropic.com/api/oauth/usage"
KEYCHAIN_SERVICE = "Claude Code-credentials"


@dataclass
class Limit:
    kind: str
    percent: float
    severity: str = "normal"
    resets_at: datetime | None = None


def _parse_ts(value) -> datetime | None:
    try:
        return datetime.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def parse_usage_payload(payload: dict) -> list[Limit]:
    limits = []
    # NB: is_active flags the currently-binding constraint, not applicability —
    # inactive meters (e.g. the weekly bars) must still be shown.
    for entry in payload.get("limits") or []:
        limits.append(
            Limit(
                kind=entry.get("kind", "?"),
                percent=entry.get("percent") or 0,
                severity=entry.get("severity", "normal"),
                resets_at=_parse_ts(entry.get("resets_at")),
            )
        )
    if limits:
        return limits
    # Legacy top-level fields, in case the limits array disappears.
    for key, kind in (("five_hour", "session"), ("seven_day", "seven_day")):
        entry = payload.get(key)
        if entry and entry.get("utilization") is not None:
            limits.append(
                Limit(
                    kind=kind,
                    percent=entry["utilization"],
                    resets_at=_parse_ts(entry.get("resets_at")),
                )
            )
    return limits


def _oauth_token() -> str:
    raw = subprocess.run(
        ["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
        capture_output=True,
        text=True,
        timeout=10,
        check=True,
    ).stdout
    return json.loads(raw)["claudeAiOauth"]["accessToken"]


def fetch_limits() -> list[Limit]:
    """Fetch live meters. Raises on any failure; caller degrades gracefully."""
    req = urllib.request.Request(
        USAGE_URL,
        headers={
            "Authorization": f"Bearer {_oauth_token()}",
            "anthropic-beta": "oauth-2025-04-20",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=15) as resp:
        return parse_usage_payload(json.load(resp))


def describe_error(exc: BaseException) -> str:
    """Short human-readable reason for a failed fetch, e.g. 'HTTP 429 Too Many Requests · rate_limit_error'."""
    if isinstance(exc, urllib.error.HTTPError):
        text = f"HTTP {exc.code} {exc.reason}"
        try:
            body = json.loads(exc.read())
            kind = (body.get("error") or {}).get("type")
        except (ValueError, TypeError, AttributeError, OSError):
            kind = None
        return f"{text} · {kind}" if kind else text
    msg = str(exc)
    return f"{type(exc).__name__}: {msg}" if msg else type(exc).__name__


LIMITS_POLL_SECONDS = 30 * 60
LIMITS_POLL_MAX_SECONDS = 2 * 60 * 60


def next_poll_delay(previous: float, failed: bool) -> float:
    """Base interval after a success; double the previous delay (capped) after a failure."""
    if not failed:
        return LIMITS_POLL_SECONDS
    return min(previous * 2, LIMITS_POLL_MAX_SECONDS)
