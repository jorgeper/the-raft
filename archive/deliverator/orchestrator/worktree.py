"""Each issue gets its own git worktree so agents never step on each other or on
your main checkout."""
import subprocess
import pathlib
import threading

# orchestrator/worktree.py -> parents[1] is the repo root (where AGENTS.md lives).
REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
WT_DIR = REPO_ROOT / "worktrees"

# `git worktree add/remove` mutate the shared .git directory, and create() has a
# check-then-act race on path.exists() — serialize them. Work INSIDE a worktree
# needs no locking; the filesystem isolation is the whole point.
_lock = threading.Lock()


def create(issue_number: int) -> pathlib.Path:
    branch = f"agent/issue-{issue_number}"
    path = WT_DIR / f"issue-{issue_number}"
    with _lock:
        if not path.exists():
            WT_DIR.mkdir(exist_ok=True)
            subprocess.run(
                ["git", "worktree", "add", "-b", branch, str(path), "main"],
                cwd=REPO_ROOT, check=True,
            )
    return path


def cleanup(issue_number: int):
    path = WT_DIR / f"issue-{issue_number}"
    with _lock:
        subprocess.run(["git", "worktree", "remove", "--force", str(path)],
                       cwd=REPO_ROOT, check=False)
