"""Live viewport for role runs: one tmux window per (issue, role) run.

tmux is the VIEWPORT ONLY — GitHub labels remain the sole scheduler and source
of truth, and the loop never depends on a window surviving. If tmux is missing
or TMUX_VIEW=0, the loop falls back to the plain captured-subprocess coder and
behaves exactly as before. Watch with: tmux attach -t deliverator
"""
import os
import re
import shutil
import subprocess

SESSION = "deliverator"


def enabled() -> bool:
    return (os.environ.get("TMUX_VIEW", "1") != "0"
            and shutil.which("tmux") is not None)


def _tmux(*args, check: bool = False):
    return subprocess.run(["tmux", *args],
                          capture_output=True, text=True, check=check)


def ensure_session():
    if _tmux("has-session", "-t", SESSION).returncode != 0:
        _tmux("new-session", "-d", "-s", SESSION, "-n", "deliverator",
              check=True)


def open_window(name: str, command: str, cwd):
    """Create (or replace) a named window (e.g. issue-12-coder) running a
    shell command."""
    ensure_session()
    _tmux("kill-window", "-t", f"{SESSION}:{name}")     # replace if present
    # NB: the trailing colon is load-bearing — a colon-less target is looked
    # up as a WINDOW name first, and window 0 shares the session's name, so
    # tmux resolves it to index 0 and fails with "index 0 in use".
    r = _tmux("new-window", "-d", "-t", f"{SESSION}:", "-n", name,
              "-c", str(cwd), command)
    if r.returncode != 0:
        raise RuntimeError(f"tmux new-window failed: {r.stderr.strip()}")


def cleanup_closed(open_issue_numbers):
    """Opportunistically drop windows whose issues are no longer open. Windows
    for open issues stay (finished runs remain scrollable)."""
    r = _tmux("list-windows", "-t", SESSION, "-F", "#{window_name}")
    if r.returncode != 0:
        return                                          # no session — nothing to do
    keep = {int(n) for n in open_issue_numbers}
    for name in r.stdout.split():
        m = re.match(r"issue-(\d+)", name)
        if m and int(m.group(1)) not in keep:
            _tmux("kill-window", "-t", f"{SESSION}:{name}")
