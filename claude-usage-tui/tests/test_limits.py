from claude_usage.limits import parse_usage_payload

SAMPLE = {
    "five_hour": {"utilization": 52.0, "resets_at": "2026-09-06T06:10:00+00:00"},
    "seven_day": {"utilization": 26.0, "resets_at": "2026-09-07T12:00:00+00:00"},
    "limits": [
        {
            "kind": "session",
            "percent": 52,
            "severity": "normal",
            "resets_at": "2026-09-06T06:10:00+00:00",
            "is_active": True,
        },
        {
            "kind": "seven_day",
            "percent": 26,
            "severity": "normal",
            "resets_at": "2026-09-07T12:00:00+00:00",
            "is_active": True,
        },
        # is_active means "currently the binding constraint", NOT applicability —
        # inactive meters must still be shown.
        {
            "kind": "weekly_scoped",
            "percent": 44,
            "severity": "normal",
            "resets_at": "2026-09-07T12:00:00+00:00",
            "is_active": False,
        },
    ],
}


def test_parses_all_limits_including_inactive():
    limits = parse_usage_payload(SAMPLE)
    assert [l.kind for l in limits] == ["session", "seven_day", "weekly_scoped"]
    assert limits[0].percent == 52
    assert limits[0].resets_at.day == 6
    assert limits[1].severity == "normal"


def test_falls_back_to_legacy_fields_when_no_limits_array():
    limits = parse_usage_payload(
        {"five_hour": {"utilization": 10.0, "resets_at": "2026-09-06T06:10:00+00:00"}}
    )
    assert limits[0].kind == "session"
    assert limits[0].percent == 10.0


def test_describe_error_shows_http_status_and_api_error_type():
    import io
    import urllib.error
    from email.message import Message

    from claude_usage.limits import describe_error

    body = io.BytesIO(
        b'{"error": {"type": "rate_limit_error", "message": "Rate limited. Please try again later."}}'
    )
    exc = urllib.error.HTTPError("https://x", 429, "Too Many Requests", Message(), body)
    assert describe_error(exc) == "HTTP 429 Too Many Requests · rate_limit_error"


def test_describe_error_http_without_json_body_falls_back_to_status():
    import io
    import urllib.error
    from email.message import Message

    from claude_usage.limits import describe_error

    exc = urllib.error.HTTPError("https://x", 502, "Bad Gateway", Message(), io.BytesIO(b"<html>"))
    assert describe_error(exc) == "HTTP 502 Bad Gateway"


def test_describe_error_non_http_uses_exception_name_and_message():
    from claude_usage.limits import describe_error

    assert describe_error(TimeoutError("timed out")) == "TimeoutError: timed out"
    assert describe_error(KeyError()) == "KeyError"


def test_poll_delay_resets_to_base_on_success():
    from claude_usage.limits import LIMITS_POLL_SECONDS, next_poll_delay

    assert next_poll_delay(LIMITS_POLL_SECONDS * 4, failed=False) == LIMITS_POLL_SECONDS


def test_poll_delay_doubles_on_failure_up_to_cap():
    from claude_usage.limits import LIMITS_POLL_MAX_SECONDS, LIMITS_POLL_SECONDS, next_poll_delay

    d1 = next_poll_delay(LIMITS_POLL_SECONDS, failed=True)
    d2 = next_poll_delay(d1, failed=True)
    d3 = next_poll_delay(d2, failed=True)
    assert d1 == LIMITS_POLL_SECONDS * 2
    assert d2 == LIMITS_POLL_MAX_SECONDS
    assert d3 == LIMITS_POLL_MAX_SECONDS
