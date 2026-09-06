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
