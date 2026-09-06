import json
import os
import time
from datetime import datetime, timedelta, timezone

from claude_usage.sessions import recent_sessions


def write_session(path, cwd, ago_seconds):
    line = json.dumps(
        {"type": "user", "timestamp": "2026-09-05T18:00:00Z", "cwd": cwd, "message": {}}
    )
    path.write_text(line + "\n")
    mtime = time.time() - ago_seconds
    os.utime(path, (mtime, mtime))


def test_recent_sessions_reports_cwd_and_age(tmp_path):
    proj = tmp_path / "p1"
    proj.mkdir()
    write_session(proj / "live.jsonl", "/Users/x/src/marky-mark", ago_seconds=60)
    write_session(proj / "stale.jsonl", "/Users/x/old", ago_seconds=3600)

    sessions = recent_sessions(tmp_path, max_age_seconds=600)
    assert len(sessions) == 1
    assert sessions[0].cwd == "/Users/x/src/marky-mark"
    assert 50 <= sessions[0].idle_seconds <= 120
