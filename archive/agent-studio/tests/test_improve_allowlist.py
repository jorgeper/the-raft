"""The path allowlist (self-improve-spec R19/R21), enforced at BOTH stages:
proposal validation (improver dispatch) and apply time. Prose in the improver's
prompt is intent; these code paths are the guard."""

import pytest
from test_improve_apply import PROPOSAL, _reviewable_item, studio_repo
from test_improver import GOOD_OUTPUT, _evolving_cfg
from test_orchestrator import make_world

from studio.cli import main
from studio.improve import ALLOWLIST, ImproveError, diff_paths, validate_paths

FORBIDDEN = [
    "studio/loop.py",  # harness source
    "prompts/coder.md",  # the classic set is sacred
    "AGENTS.md",
    ".claude/settings.json",
    ".claude/hooks/guard.sh",
    ".claude/skills/tdd-workflow/SKILL.md",  # only prompt-audit is writable
    "../escape.md",
    "/etc/passwd",
]


@pytest.mark.parametrize("path", FORBIDDEN)
def test_validation_rejects_forbidden_paths(path):
    """R19: every forbidden path is refused with the offender named."""
    with pytest.raises(ImproveError):
        validate_paths({"prompts/evolving/coder.md", path})


def test_allowlist_is_exactly_the_two_trees():
    assert ALLOWLIST == ("prompts/evolving/", ".claude/skills/prompt-audit/")


@pytest.mark.parametrize("path", ["studio/orchestrator.py", "prompts/reviewer.md"])
def test_dispatch_stage_rejects(tmp_path, path):
    """R19 at stage one: the improver's own proposal is checked before review."""
    bad = GOOD_OUTPUT.replace("prompts/evolving/coder.md", path)
    cfg = _evolving_cfg(tmp_path)
    _, tracker, _, _, orch, _ = make_world(tmp_path, cfg=cfg, responses=[bad])
    tracker.create("improve", "", "improve:drafting", kind="improvement")
    orch.tick()
    assert tracker.get("1").state == "needs-human"
    assert path in tracker.get("1").comments[-1].body


@pytest.mark.parametrize("path", ["studio/orchestrator.py", "prompts/prd.md"])
def test_apply_stage_rejects(tmp_path, path):
    """R21 at stage two: apply re-validates even if drafting was bypassed."""
    root, cfg_path = studio_repo(tmp_path)
    bad = PROPOSAL.replace("prompts/evolving/coder.md", path)
    tracker, item = _reviewable_item(root, body=bad)
    assert main(["--config", str(cfg_path), "approve", item.id]) == 1
    assert tracker.get(item.id).state == "needs-human"
    # nothing was committed
    import subprocess

    log = subprocess.run(["git", "log", "--oneline"], cwd=root, capture_output=True, text=True)
    assert len(log.stdout.splitlines()) == 1  # just the seed commit


def test_diff_paths_sees_renames_as_both_sides():
    """A rename out of the allowlist is caught because both sides are collected."""
    diff = (
        "--- a/prompts/evolving/coder.md\n"
        "+++ b/prompts/stealth-classic.md\n"
        "@@ -1 +1 @@\n-# a\n+# b\n"
    )
    with pytest.raises(ImproveError, match="stealth-classic"):
        validate_paths(diff_paths(diff))
