from datetime import datetime, timedelta, timezone

from claude_usage.format import fmt_delta, fmt_when

NOW = datetime(2026, 9, 5, 21, 39, tzinfo=timezone.utc)


def test_fmt_when_shows_weekday_clock_and_countdown():
    target = NOW + timedelta(hours=2, minutes=10)
    expected_clock = f"{target.astimezone():%a %H:%M}"  # local tz, like the panel
    assert fmt_when(target, now=NOW) == f"{expected_clock} (in 2h 10m)"


def test_fmt_when_counts_days_past_24h():
    target = NOW + timedelta(days=1, hours=3, minutes=5)
    assert fmt_when(target, now=NOW).endswith("(in 1d 3h 5m)")


def test_fmt_when_in_the_past_says_now():
    assert fmt_when(NOW - timedelta(minutes=1), now=NOW).endswith("(now)")


def test_fmt_delta_names_the_reset_moment():
    target = NOW + timedelta(hours=7, minutes=21)
    assert fmt_delta(target, now=NOW) == f"resets {target.astimezone():%a %H:%M} (in 7h 21m)"
    assert fmt_delta(None) == ""
    assert fmt_delta(NOW - timedelta(seconds=5), now=NOW) == "resetting…"
