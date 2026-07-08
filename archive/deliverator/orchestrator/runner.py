"""Launch a role agent as a top-level, fresh-context Claude Code run.

Each role is a native agent definition in .claude/agents/<role>.md — the
frontmatter (tools, model) plus the body (system prompt) is the single source
of truth. A run is launched with `--agent <role>`, and we ALSO pass
--allowedTools/--model computed from the same frontmatter so headless runs
never hit a permission prompt and models can be overridden per role from .env
(MODEL_<ROLE>, dashes as underscores, e.g. MODEL_CODE_REVIEW_SECURITY=opus).

Every run appends its stream-json transcript to logs/<role>-issue-<N>.jsonl.
With tmux available (TMUX_VIEW!=0) the run executes live in window
issue-<N>-<role> and completion is detected via a .done sentinel file;
otherwise it's a captured subprocess. tmux is the viewport only — GitHub
labels remain the sole scheduler, and runs are never resumed: fresh context
per iteration, memory in files.
"""
import os
import json
import re
import time
import shlex
import subprocess
import pathlib
from typing import NamedTuple

from rich.console import Console

import worktree
import tmuxview

con = Console()

LOGS = pathlib.Path(__file__).parent / "logs"
AGENTS_DIR = worktree.REPO_ROOT / ".claude" / "agents"

# Runaway guard: wall-clock per run (no budget caps, no turn caps).
ROLE_TIMEOUT = int(os.environ.get("ROLE_TIMEOUT", "900"))
CODER_TIMEOUT = int(os.environ.get("CODER_TIMEOUT", "3600"))

# Reviewer roles return a machine-readable verdict instead of prose we scrape.
VERDICT_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["APPROVE", "REVISE"]},
        "findings": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["verdict", "findings"],
}


class RoleResult(NamedTuple):
    ok: bool
    text: str          # final result text (capped) or error tail
    structured: dict | None   # parsed --json-schema output, when requested


# ---------- agent files: frontmatter is the wiring, body is the prompt ----------
def parse_agent_file(text: str) -> dict:
    """Pure: parse an agent definition's YAML-ish frontmatter (name,
    description, tools, model) and body. Tools become a comma-joined string
    ready for --allowedTools."""
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        raise ValueError("agent file has no frontmatter")
    meta, body = {}, m.group(2).strip()
    for line in m.group(1).splitlines():
        if ":" in line:
            key, _, val = line.partition(":")
            meta[key.strip()] = val.strip()
    if "tools" in meta:
        meta["tools"] = ",".join(t.strip() for t in meta["tools"].split(",") if t.strip())
    meta["body"] = body
    return meta


def load_agent(role: str) -> dict:
    return parse_agent_file((AGENTS_DIR / f"{role}.md").read_text())


def role_model(role: str, default: str, env=os.environ) -> str:
    """Model precedence: MODEL_<ROLE> from .env, else the agent file's model."""
    return env.get("MODEL_" + role.upper().replace("-", "_"), default)


def build_cmd(role: str, tools: str, model: str, schema: dict | None) -> list[str]:
    """Pure: the claude invocation for a role run (prompt arrives separately —
    argv in captured mode, stdin file in tmux mode)."""
    cmd = ["claude", "-p", "--agent", role,
           "--allowedTools", tools,
           "--model", model,
           "--permission-mode", "acceptEdits",
           "--output-format", "stream-json", "--verbose"]
    if schema:
        cmd += ["--json-schema", json.dumps(schema)]
    return cmd


# ---------- stream / sentinel parsing (pure) ----------
def final_result_obj(text: str) -> dict | None:
    """A stream-json transcript ends with a {"type": "result"} object — find
    the last one, skipping separators and non-JSON noise."""
    result = None
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and obj.get("type") == "result":
            result = obj
    return result


def outcome(obj: dict) -> RoleResult:
    return RoleResult(ok=not obj.get("is_error", True),
                      text=str(obj.get("result", ""))[:2000],
                      structured=obj.get("structured_output"))


def parse_sentinel(text: str) -> RoleResult:
    """The .done sentinel holds the stream's final result object, or an
    {"type": "error", "exit_code": N} marker written by the window wrapper.
    Malformed content: ok=False, tail as text."""
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        return RoleResult(False, text[-2000:], None)
    if isinstance(obj, dict) and obj.get("type") == "result":
        return outcome(obj)
    return RoleResult(False, f"run exited abnormally: {json.dumps(obj)[:500]}", None)


# ---------- execution ----------
def _in_tmux(role: str, n: int, cmd: list[str], prompt: str, cwd,
             log: pathlib.Path, timeout: int, env: dict) -> RoleResult:
    """Run in tmux window issue-<N>-<role>: live output via tee, completion via
    a sentinel file we poll. The window stays open for scrollback."""
    q = shlex.quote
    stem = LOGS / f"{role}-issue-{n}"
    prompt_file = stem.with_suffix(".prompt")
    pass_log = stem.with_suffix(".pass.jsonl")
    done = stem.with_suffix(".done")
    prompt_file.write_text(prompt)
    done.unlink(missing_ok=True)
    pass_log.unlink(missing_ok=True)
    exports = "".join(f"export {k}={q(v)}\n" for k, v in env.items())
    script = stem.with_suffix(".sh")
    script.write_text(f"""#!/bin/bash
# generated by runner.py — live window for {role} on issue {n}
set -o pipefail
{exports}{" ".join(q(a) for a in cmd)} < {q(str(prompt_file))} | tee -a {q(str(log))} {q(str(pass_log))}
ec=${{PIPESTATUS[0]}}
grep -a '"type": *"result"' {q(str(pass_log))} | tail -n 1 > {q(str(done))}.tmp
if [ ! -s {q(str(done))}.tmp ]; then
  echo "{{\\"type\\": \\"error\\", \\"exit_code\\": $ec}}" > {q(str(done))}.tmp
fi
mv {q(str(done))}.tmp {q(str(done))}
echo; echo "=== {role} for issue {n} finished (exit $ec) — window stays open for scrollback ==="
sleep 86400
""")
    script.chmod(0o755)
    tmuxview.open_window(f"issue-{n}-{role}", str(script), cwd=cwd)

    deadline = time.time() + timeout
    while time.time() < deadline:
        if done.exists():
            text = done.read_text()
            done.unlink()
            return parse_sentinel(text)
        time.sleep(5)
    return RoleResult(False, f"{role} timed out after {timeout}s "
                      f"(window issue-{n}-{role} left open)", None)


def run_role(role: str, issue_number: int, prompt: str, cwd,
             schema: dict | None = None, timeout: int | None = None,
             extra_env: dict | None = None) -> RoleResult:
    """One fresh-context role run. Returns (ok, text, structured)."""
    agent = load_agent(role)
    model = role_model(role, agent.get("model", "sonnet"))
    cmd = build_cmd(role, agent.get("tools", "Read,Glob,Grep"), model, schema)
    timeout = timeout or ROLE_TIMEOUT
    env = {**os.environ, **(extra_env or {})}

    LOGS.mkdir(exist_ok=True)
    log = LOGS / f"{role}-issue-{issue_number}.jsonl"
    with log.open("a") as f:
        f.write(f"=== pass {time.strftime('%Y-%m-%dT%H:%M:%S%z')} ===\n")

    # the entire text after "watch: " must stay a valid shell command —
    # users paste it whole
    where = (f"watch: tmux attach -t {tmuxview.SESSION} \\; "
             f"select-window -t issue-{issue_number}-{role}"
             if tmuxview.enabled() else f"log: logs/{log.name}")
    con.print(f"[cyan]#{issue_number}[/] [magenta]{role}[/] "
              f"[dim]{model} started — {where}[/]")
    t0 = time.time()
    if tmuxview.enabled():
        result = _in_tmux(role, issue_number, cmd, prompt, cwd, log, timeout,
                          extra_env or {})
    else:
        p = subprocess.run(cmd + [prompt], cwd=cwd, capture_output=True,
                           text=True, timeout=timeout,
                           stdin=subprocess.DEVNULL, env=env)
        with log.open("a") as f:
            f.write(p.stdout if p.stdout.endswith("\n") else p.stdout + "\n")
        obj = final_result_obj(p.stdout)
        result = (RoleResult(False, (p.stdout + p.stderr)[-2000:], None)
                  if obj is None else outcome(obj))
    color = "green" if result.ok else "red"
    con.print(f"[cyan]#{issue_number}[/] [magenta]{role}[/] "
              f"[{color}]finished ok={result.ok}[/] "
              f"[dim]({int(time.time() - t0)}s)[/]")
    return result


def verdict_md(r: RoleResult) -> str:
    """Render a reviewer result for the memo and the issue comment."""
    if not r.ok:
        return f"⚠️ review run failed:\n```\n{r.text}\n```"
    if r.structured:
        findings = "".join(f"\n- {f}" for f in r.structured.get("findings", []))
        return f"**Verdict: {r.structured['verdict']}**{findings or chr(10) + '- (no findings)'}"
    return r.text
