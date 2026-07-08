"""Real-tmux integration tests for the viewport (skipped when tmux is absent).

Regression: a colon-less `-t <session>` is ambiguous — if any WINDOW shares
the target string (and ensure_session names window 0 after the session),
tmux resolves it to that window and fails with "create window failed:
index 0 in use". The target must be `<session>:` (trailing colon =
unambiguous session target, next free index).
"""
import shutil
import subprocess
import uuid

import pytest

import tmuxview

pytestmark = pytest.mark.skipif(shutil.which("tmux") is None,
                                reason="tmux not installed")


@pytest.fixture
def session(monkeypatch):
    name = f"deliverator-test-{uuid.uuid4().hex[:8]}"
    monkeypatch.setattr(tmuxview, "SESSION", name)
    # pre-create the session the way production ends up: window 0 carries the
    # same name as the session — the exact ambiguity that broke new-window
    subprocess.run(["tmux", "new-session", "-d", "-s", name, "-n", name],
                   capture_output=True, check=True)
    yield name
    subprocess.run(["tmux", "kill-session", "-t", name], capture_output=True)


def _windows(name):
    r = subprocess.run(["tmux", "list-windows", "-t", name,
                        "-F", "#{window_name}"],
                       capture_output=True, text=True)
    return r.stdout.split()


def test_open_window_works_when_session_already_has_window_zero(session, tmp_path):
    tmuxview.open_window("issue-7-designer", "sleep 30", cwd=tmp_path)
    tmuxview.open_window("issue-7-coder", "sleep 30", cwd=tmp_path)
    ws = _windows(session)
    assert "issue-7-designer" in ws
    assert "issue-7-coder" in ws


def test_open_window_replaces_existing_window_with_same_name(session, tmp_path):
    tmuxview.open_window("issue-9-coder", "sleep 30", cwd=tmp_path)
    tmuxview.open_window("issue-9-coder", "sleep 30", cwd=tmp_path)
    assert _windows(session).count("issue-9-coder") == 1


def test_cleanup_closed_kills_only_stale_issue_windows(session, tmp_path):
    tmuxview.open_window("issue-7-coder", "sleep 30", cwd=tmp_path)
    tmuxview.open_window("issue-8-coder", "sleep 30", cwd=tmp_path)
    tmuxview.cleanup_closed({8})
    ws = _windows(session)
    assert "issue-8-coder" in ws
    assert "issue-7-coder" not in ws
