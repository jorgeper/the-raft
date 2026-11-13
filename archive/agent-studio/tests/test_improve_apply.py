"""Apply / reject / improvements log (self-improve-spec R21/R22/R24): the human
gate applies the diff via git with the allowlist re-checked, commits only the
proposal's files, and records a watching entry; reject applies nothing."""

import subprocess

import yaml

from studio.cli import main
from studio.improve import ImprovementsLog

PROPOSAL = """\
The coder forgets to orient; tell it to run gates first.

```diff
--- a/prompts/evolving/coder.md
+++ b/prompts/evolving/coder.md
@@ -1 +1,2 @@
 # Coder agent
+Run the standing gates before touching any file.
```

EXPECT: coder.iterations_per_verified decrease
"""


def _git(cwd, *args):
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


def studio_repo(tmp_path):
    """A real git repo holding a loadable evolving-set studio config."""
    root = tmp_path / "studio-root"
    (root / "config").mkdir(parents=True)
    (root / "prompts" / "evolving").mkdir(parents=True)
    (root / "prompts" / "prd.md").write_text("# prd classic\n")
    (root / "prompts" / "evolving" / "prd.md").write_text("# prd evolving\n")
    (root / "prompts" / "evolving" / "coder.md").write_text("# Coder agent\n")
    (root / "prompts" / "evolving" / "improver.md").write_text("# improver\n")
    raw = {
        "tracker": {"kind": "markdown", "root": ".work"},
        "runtimes": {"claude": {"cmd": "claude"}},
        "active_set": "evolving",
        "agent_sets": {
            "evolving": {
                "improve_every": 1,
                "agents": {
                    "prd": {"runtime": "claude", "prompt": "prompts/evolving/prd.md",
                            "handles": "prd:drafting"},
                    "improver": {"runtime": "claude",
                                 "prompt": "prompts/evolving/improver.md",
                                 "handles": "improve:drafting"},
                },
            }
        },
    }
    cfg_path = root / "config" / "studio.yaml"
    cfg_path.write_text(yaml.safe_dump(raw))
    _git(root, "init", "-q", "-b", "main")
    _git(root, "config", "user.email", "t@t")
    _git(root, "config", "user.name", "t")
    _git(root, "add", "-A")
    _git(root, "commit", "-qm", "seed")
    return root, cfg_path


def _reviewable_item(root, body=PROPOSAL):
    from studio.state import Actor
    from studio.tracker.markdown import MarkdownTracker

    tracker = MarkdownTracker(root / ".work")
    item = tracker.create("improve the coder", "scorecard...", "improve:drafting",
                          kind="improvement")
    tracker.comment(item.id, body, author="improver")
    tracker.transition(item.id, "improve:review", Actor.AGENT)
    return tracker, item


def _head_files(root):
    out = subprocess.run(
        ["git", "show", "--name-only", "--pretty=format:"], cwd=root,
        capture_output=True, text=True, check=True,
    )
    return [line for line in out.stdout.splitlines() if line]


def test_approve_applies_commits_and_records(tmp_path, capsys):
    root, cfg_path = studio_repo(tmp_path)
    tracker, item = _reviewable_item(root)
    # unrelated dirty file must NOT ride along in the improve commit
    (root / "prompts" / "prd.md").write_text("# prd classic, locally dirty\n")

    assert main(["--config", str(cfg_path), "approve", item.id]) == 0

    assert "Run the standing gates" in (root / "prompts" / "evolving" / "coder.md").read_text()
    assert _head_files(root) == ["prompts/evolving/coder.md"]  # R21: only allowlisted paths
    log_msg = subprocess.run(["git", "log", "-1", "--pretty=%s"], cwd=root,
                             capture_output=True, text=True, check=True).stdout
    assert log_msg.startswith("improve(evolving): item 1 —")
    assert tracker.get(item.id).state == "done"
    # subagent files regenerated for the active set
    assert (root / ".claude" / "agents" / "studio-improver.md").is_file()
    # watching record with expect + baseline + sha
    records = ImprovementsLog(root / "memory" / "improvements.jsonl").entries()
    applied = [e for e in records if e["event"] == "applied"]
    assert applied[0]["files"] == ["prompts/evolving/coder.md"]
    assert applied[0]["expect"] == "coder.iterations_per_verified decrease"
    assert applied[0]["status"] == "watching"
    assert "baseline" in applied[0] and len(applied[0]["sha"]) >= 7


def test_apply_check_failure_writes_nothing(tmp_path, capsys):
    """R21: a diff that does not apply -> needs-human, tree untouched, no commit."""
    root, cfg_path = studio_repo(tmp_path)
    stale = PROPOSAL.replace(" # Coder agent", " # A file that never existed")
    tracker, item = _reviewable_item(root, body=stale)
    head_before = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root,
                                 capture_output=True, text=True).stdout

    assert main(["--config", str(cfg_path), "approve", item.id]) == 1

    assert tracker.get(item.id).state == "needs-human"
    assert (root / "prompts" / "evolving" / "coder.md").read_text() == "# Coder agent\n"
    head_after = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root,
                                capture_output=True, text=True).stdout
    assert head_before == head_after
    assert "apply failed" in tracker.get(item.id).comments[-1].body


def test_apply_revalidates_allowlist(tmp_path, capsys):
    """R21: even a proposal that sneaked past drafting is re-checked at apply."""
    root, cfg_path = studio_repo(tmp_path)
    bad = PROPOSAL.replace("prompts/evolving/coder.md", "studio/loop.py")
    tracker, item = _reviewable_item(root, body=bad)
    assert main(["--config", str(cfg_path), "approve", item.id]) == 1
    assert tracker.get(item.id).state == "needs-human"
    assert "studio/loop.py" in tracker.get(item.id).comments[-1].body


def test_reject_applies_nothing_and_records(tmp_path, capsys):
    """R22: reject comments the reason, parks the item, applies nothing."""
    root, cfg_path = studio_repo(tmp_path)
    tracker, item = _reviewable_item(root)
    assert main(["--config", str(cfg_path), "reject", item.id,
                 "--reason", "diff weakens the NEVER section"]) == 0
    assert tracker.get(item.id).state == "needs-human"
    assert "diff weakens the NEVER section" in tracker.get(item.id).comments[-1].body
    assert (root / "prompts" / "evolving" / "coder.md").read_text() == "# Coder agent\n"
    log = ImprovementsLog(root / "memory" / "improvements.jsonl")
    assert log.current_status(item.id) == "rejected"


def test_reject_works_on_other_human_gates(tmp_path, capsys):
    root, cfg_path = studio_repo(tmp_path)
    from studio.state import Actor
    from studio.tracker.markdown import MarkdownTracker

    tracker = MarkdownTracker(root / ".work")
    item = tracker.create("a feature", "", "prd:drafting", kind="feature")
    tracker.transition(item.id, "prd:review", Actor.AGENT)
    assert main(["--config", str(cfg_path), "reject", item.id, "--reason", "wrong scope"]) == 0
    assert tracker.get(item.id).state == "needs-human"
    # no improvement-status record for non-improvement items
    assert ImprovementsLog(root / "memory" / "improvements.jsonl").entries() == []


def test_reject_refuses_non_gated_state(tmp_path, capsys):
    root, cfg_path = studio_repo(tmp_path)
    from studio.tracker.markdown import MarkdownTracker

    tracker = MarkdownTracker(root / ".work")
    item = tracker.create("a feature", "", "backlog", kind="feature")
    assert main(["--config", str(cfg_path), "reject", item.id]) == 1
    assert tracker.get(item.id).state == "backlog"


def test_improvements_listing(tmp_path, capsys):
    """R24: the log lists id, files, expected movement, and status."""
    root, cfg_path = studio_repo(tmp_path)
    _, item = _reviewable_item(root)
    assert main(["--config", str(cfg_path), "approve", item.id]) == 0
    capsys.readouterr()
    assert main(["--config", str(cfg_path), "improvements"]) == 0
    out = capsys.readouterr().out
    assert "#1" in out
    assert "prompts/evolving/coder.md" in out
    assert "coder.iterations_per_verified decrease" in out
    assert "watching" in out


def test_improvements_listing_empty(tmp_path, capsys):
    root, cfg_path = studio_repo(tmp_path)
    assert main(["--config", str(cfg_path), "improvements"]) == 0
    assert "no improvements" in capsys.readouterr().out
