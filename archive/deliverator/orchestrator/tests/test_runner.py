"""runner.py: agent-file parsing, model overrides, command building, verdicts."""
import json

import runner
from runner import (RoleResult, build_cmd, final_result_obj, outcome,
                    parse_agent_file, parse_sentinel, role_model, verdict_md)

AGENT = """---
name: code-review-security
description: Security reviewer
tools: Read, Glob, Bash(git diff *)
model: opus
---
You are CODE REVIEWER B.

Be terse.
"""


def test_parse_agent_file():
    meta = parse_agent_file(AGENT)
    assert meta["name"] == "code-review-security"
    assert meta["tools"] == "Read,Glob,Bash(git diff *)"
    assert meta["model"] == "opus"
    assert meta["body"].startswith("You are CODE REVIEWER B.")


def test_parse_agent_file_requires_frontmatter():
    try:
        parse_agent_file("just a prompt, no frontmatter")
        raise AssertionError("should have raised")
    except ValueError:
        pass


def test_role_model_env_override_wins():
    env = {"MODEL_CODE_REVIEW_SECURITY": "haiku"}
    assert role_model("code-review-security", "opus", env=env) == "haiku"
    assert role_model("code-review-security", "opus", env={}) == "opus"


def test_build_cmd_wires_agent_tools_model_and_schema():
    cmd = build_cmd("designer", "Read,Write", "sonnet", runner.VERDICT_SCHEMA)
    assert cmd[:2] == ["claude", "-p"]
    assert cmd[cmd.index("--agent") + 1] == "designer"
    assert cmd[cmd.index("--allowedTools") + 1] == "Read,Write"
    assert cmd[cmd.index("--model") + 1] == "sonnet"
    assert json.loads(cmd[cmd.index("--json-schema") + 1]) == runner.VERDICT_SCHEMA
    assert "--json-schema" not in build_cmd("designer", "Read", "sonnet", None)


RESULT = {"type": "result", "is_error": False, "result": "done",
          "structured_output": {"verdict": "REVISE", "findings": ["a", "b"]}}


def test_final_result_obj_takes_last_result_and_skips_noise():
    stream = "\n".join([
        "=== pass 2026-07-04 ===",
        json.dumps({"type": "assistant"}),
        "{broken",
        json.dumps({**RESULT, "result": "old"}),
        json.dumps(RESULT),
    ])
    assert final_result_obj(stream)["result"] == "done"
    assert final_result_obj("no result here") is None


def test_outcome_extracts_structured_output():
    r = outcome(RESULT)
    assert r == RoleResult(True, "done", RESULT["structured_output"])


def test_parse_sentinel_error_marker_and_garbage():
    assert parse_sentinel('{"type": "error", "exit_code": 9}').ok is False
    bad = parse_sentinel("not json at all")
    assert bad.ok is False and "not json" in bad.text


def test_verdict_md_renders_structured_and_fallbacks():
    md = verdict_md(outcome(RESULT))
    assert "**Verdict: REVISE**" in md and "\n- a" in md and "\n- b" in md
    assert verdict_md(RoleResult(True, "prose only", None)) == "prose only"
    assert "review run failed" in verdict_md(RoleResult(False, "boom", None))
