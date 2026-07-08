"""The improver agent (self-improve-spec §6): trigger cadence (R17), output
contract (R18), allowlist at validation (R19), single-flight (R8), and the
improve:review handoff (R20)."""

import pytest
from test_orchestrator import make_cfg, make_world

from studio.config import AgentConfig
from studio.improve import (
    ImproveError,
    ImprovementsLog,
    diff_paths,
    parse_proposal,
    validate_paths,
)
from studio.metrics import ScorecardLog

GOOD_DIFF = """\
--- a/prompts/evolving/coder.md
+++ b/prompts/evolving/coder.md
@@ -1,3 +1,4 @@
 # Coder agent
+Run the standing gates before touching any file.
"""

GOOD_OUTPUT = f"""\
The coder keeps re-breaking the same gate; orient before editing.

```diff
{GOOD_DIFF}```

EXPECT: coder.iterations_per_verified decrease
"""


# --- R18: the output contract ---------------------------------------------------


def test_parse_proposal_happy_path():
    proposal = parse_proposal(GOOD_OUTPUT)
    assert proposal.rationale.startswith("The coder keeps re-breaking")
    assert proposal.diff == GOOD_DIFF
    assert (proposal.expect_agent, proposal.expect_metric, proposal.expect_direction) == (
        "coder", "iterations_per_verified", "decrease",
    )


@pytest.mark.parametrize(
    "mutation, match",
    [
        (lambda s: s.replace("```diff", "```"), "diff block"),
        (lambda s: s + f"\n```diff\n{GOOD_DIFF}```\n", "exactly one"),
        (lambda s: s.replace("EXPECT: coder.iterations_per_verified decrease", ""), "EXPECT"),
        (lambda s: s.replace("decrease", "shrink"), "EXPECT"),
        (lambda s: s.split("```diff")[1].join(["```diff", ""]), "rationale"),
    ],
)
def test_parse_proposal_rejects_malformed(mutation, match):
    with pytest.raises(ImproveError, match=match):
        parse_proposal(mutation(GOOD_OUTPUT))


def test_diff_paths_reads_both_sides():
    diff = (
        "--- a/prompts/evolving/coder.md\n+++ b/prompts/evolving/coder.md\n@@\n x\n"
        "--- /dev/null\n+++ b/.claude/skills/prompt-audit/SKILL.md\n@@\n+new\n"
    )
    assert diff_paths(diff) == {
        "prompts/evolving/coder.md",
        ".claude/skills/prompt-audit/SKILL.md",
    }


# --- R19: the allowlist, enforced in code ----------------------------------------


def test_validate_paths_allowlist():
    validate_paths({"prompts/evolving/coder.md", ".claude/skills/prompt-audit/SKILL.md"})
    with pytest.raises(ImproveError, match="studio/loop.py"):
        validate_paths({"prompts/evolving/coder.md", "studio/loop.py"})
    with pytest.raises(ImproveError, match="prompts/coder.md"):
        validate_paths({"prompts/coder.md"})  # the classic set is sacred


# --- R17: the trigger -------------------------------------------------------------


def _evolving_cfg(tmp_path, improve_every=2):
    from dataclasses import replace

    cfg = make_cfg(tmp_path)
    (cfg.root / "prompts" / "improver.md").write_text("# improver role prompt\n")
    agents = dict(cfg.agents)
    agents["improver"] = AgentConfig(
        name="improver", runtime="claude", prompt=cfg.root / "prompts/improver.md",
        handles="improve:drafting", memory="improver",
    )
    return replace(cfg, agents=agents, active_set="evolving", improve_every=improve_every)


def _seed_done(cfg, ids, kind="feature"):
    log = ScorecardLog(cfg.root / "memory" / "scorecard.jsonl")
    for item_id in ids:
        log.append(item_id, set_name=cfg.active_set, kind=kind, agents={})


def test_trigger_files_item_at_cadence(tmp_path):
    cfg = _evolving_cfg(tmp_path, improve_every=2)
    _, tracker, _, _, orch, _ = make_world(tmp_path, cfg=cfg)
    _seed_done(cfg, ["1", "2"])
    orch.tick()
    items = tracker.list(kind="improvement")
    assert len(items) == 1
    assert items[0].state == "improve:drafting"
    assert "scorecard" in items[0].body.lower()
    filed = [e for e in ImprovementsLog(cfg.root / "memory" / "improvements.jsonl").entries()
             if e["event"] == "filed"]
    assert filed[0]["covers"] == ["1", "2"]


def test_trigger_below_cadence_files_nothing(tmp_path):
    cfg = _evolving_cfg(tmp_path, improve_every=3)
    _, tracker, _, _, orch, _ = make_world(tmp_path, cfg=cfg)
    _seed_done(cfg, ["1", "2"])
    orch.tick()
    assert tracker.list(kind="improvement") == []


def test_trigger_ignores_improvement_and_foreign_set_snapshots(tmp_path):
    cfg = _evolving_cfg(tmp_path, improve_every=2)
    _, tracker, _, _, orch, _ = make_world(tmp_path, cfg=cfg)
    _seed_done(cfg, ["1"])
    _seed_done(cfg, ["90"], kind="improvement")  # improvements don't count
    log = ScorecardLog(cfg.root / "memory" / "scorecard.jsonl")
    log.append("91", set_name="classic", kind="feature", agents={})  # other set
    orch.tick()
    assert tracker.list(kind="improvement") == []


def test_single_flight_r8(tmp_path):
    """R8: one open improvement item at a time; the trigger declines a second."""
    cfg = _evolving_cfg(tmp_path, improve_every=1)
    _, tracker, _, _, orch, _ = make_world(tmp_path, cfg=cfg)
    tracker.create("open proposal", "", "improve:drafting", kind="improvement")
    _seed_done(cfg, ["1", "2", "3"])
    assert orch.maybe_file_improvement() is None
    assert orch.maybe_file_improvement(force=True) is None  # manual respects R8 too
    assert len(tracker.list(kind="improvement")) == 1


def test_manual_force_ignores_cadence(tmp_path):
    cfg = _evolving_cfg(tmp_path, improve_every=50)
    _, tracker, _, _, orch, _ = make_world(tmp_path, cfg=cfg)
    _seed_done(cfg, ["1"])
    item = orch.maybe_file_improvement(force=True)
    assert item is not None
    assert tracker.get(item.id).state == "improve:drafting"


def test_no_improver_agent_means_no_trigger(tmp_path):
    """The classic set never files improvement items."""
    cfg, tracker, _, _, orch, _ = make_world(tmp_path)  # default cfg, no improver
    _seed_done(cfg, ["1", "2", "3", "4", "5"])
    orch.tick()
    assert tracker.list(kind="improvement") == []


# --- R18/R20: dispatch parses the contract ---------------------------------------


def test_improver_valid_proposal_moves_to_review(tmp_path):
    cfg = _evolving_cfg(tmp_path)
    _, tracker, claude_rt, _, orch, _ = make_world(tmp_path, cfg=cfg, responses=[GOOD_OUTPUT])
    tracker.create("improve the coder", "scorecard: ...", "improve:drafting", kind="improvement")
    orch.tick()
    item = tracker.get("1")
    assert item.state == "improve:review"
    assert item.comments[-1].author == "improver"
    assert "```diff" in item.comments[-1].body


def test_improver_malformed_output_goes_needs_human(tmp_path):
    """R18: missing any part -> needs-human with the parse failure quoted."""
    cfg = _evolving_cfg(tmp_path)
    _, tracker, claude_rt, _, orch, _ = make_world(
        tmp_path, cfg=cfg, responses=["I would improve things but forgot the diff."]
    )
    tracker.create("improve", "", "improve:drafting", kind="improvement")
    orch.tick()
    item = tracker.get("1")
    assert item.state == "needs-human"
    assert "diff block" in item.comments[-1].body


def test_improver_disallowed_path_goes_needs_human(tmp_path):
    """R19: a diff touching studio/ never leaves improve:drafting."""
    bad = GOOD_OUTPUT.replace("prompts/evolving/coder.md", "studio/loop.py")
    cfg = _evolving_cfg(tmp_path)
    _, tracker, claude_rt, _, orch, _ = make_world(tmp_path, cfg=cfg, responses=[bad])
    tracker.create("improve", "", "improve:drafting", kind="improvement")
    orch.tick()
    item = tracker.get("1")
    assert item.state == "needs-human"
    assert "studio/loop.py" in item.comments[-1].body


def test_improve_cli_files_item(tmp_path, capsys):
    """R17: `studio improve` files the item on demand through a real config."""
    import yaml

    from studio.cli import main

    root = tmp_path / "studio-root"
    (root / "config").mkdir(parents=True)
    (root / "prompts" / "evolving").mkdir(parents=True)
    for name in ("prd.md", "evolving/improver.md"):
        (root / "prompts" / name).write_text("# role\n")
    raw = {
        "tracker": {"kind": "markdown", "root": ".work"},
        "runtimes": {"claude": {"cmd": "claude"}},
        "active_set": "evolving",
        "agent_sets": {
            "evolving": {
                "improve_every": 1,
                "agents": {
                    "prd": {"runtime": "claude", "prompt": "prompts/prd.md",
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
    assert main(["--config", str(cfg_path), "improve"]) == 0
    assert "filed improvement item #1" in capsys.readouterr().out
    # single-flight: a second call refuses
    assert main(["--config", str(cfg_path), "improve"]) == 1
