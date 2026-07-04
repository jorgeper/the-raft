"""Deliverator: the loop. One pass = advance every ready issue by ONE state.

State is tracked entirely in GitHub labels, so the loop is restartable: kill it
any time; the next pass re-reads reality from GitHub and picks up where things
stood. A crash never loses more than a step, and a bug can't spiral through the
pipeline in seconds.

Flow (design-first):
  agent:ready / agent:design-draft  -> run_design_draft     (DESIGN.md on a branch, design PR)
  agent:design-approved             -> run_design_reviewers (2 cross-family critiques)
  agent:coding / agent:trivial      -> run_code             (coder + Docker re-check, impl PR)
  agent:code-review                 -> run_code_review      (2 cross-family reviews)

Human gates: every stage that needs you parks the issue at agent:needs-human.
Only a human label-flip proceeds. The Telegram bot mirrors these to your phone
and no-ops if TELEGRAM_* aren't configured.
"""
import os
import re
import json
import time
import subprocess
import pathlib

from rich.console import Console
from dotenv import load_dotenv

from llm import call, spent, add_cost
from agents.roles import ROLES
import gh
import worktree
import skills
import bot

load_dotenv()
con = Console()
MEM = pathlib.Path(__file__).parent / "memory"
MAX_USD = float(os.environ.get("MAX_USD_PER_RUN", "2.0"))

# "headless" (default): Claude Code runs the coder stage inside the worktree —
# it can run tests, read failures, and fix them (the inner loop). "oneshot":
# a single OpenRouter completion emits files as fenced blocks — no harness
# needed, but the model gets one blind attempt per pass.
CODER_MODE = os.environ.get("CODER_MODE", "headless")

# The independent re-check container. Adapt these to your stack — the defaults
# match the Python/Flask labs. The command must install, lint, and test.
SANDBOX_IMAGE = os.environ.get("SANDBOX_IMAGE", "python:3.11-slim")
SANDBOX_CMD = os.environ.get(
    "SANDBOX_CMD",
    "pip install -q -e . 2>/dev/null; pip install -q pytest ruff; "
    "ruff check . && pytest -q",
)


# ---------- the per-issue memo (the scratchpad memory layer) ----------
def _issue_memo(n: int) -> pathlib.Path:
    p = MEM / f"issue-{n}.md"
    p.parent.mkdir(exist_ok=True)
    if not p.exists():
        p.write_text(f"# Issue {n} scratchpad\n\n")
    return p


def _append(path: pathlib.Path, section: str, text: str):
    with path.open("a") as f:
        f.write(f"\n## {section}\n\n{text}\n")


def _conventions() -> str:
    """The always-on memory layer — AGENTS.md is primary, CLAUDE.md a shim."""
    for name in ("AGENTS.md", "CLAUDE.md"):
        p = worktree.REPO_ROOT / name
        if p.exists():
            return p.read_text()
    return ""


def _sys(role: str, issue_text: str) -> str:
    """Role system prompt + any skills matching this task (progressive disclosure)."""
    base = ROLES[role]["system"]
    extra = skills.skills_for(role, issue_text)
    return base + ("\n\n---\n\n" + extra if extra else "")


# ---------- your feedback, gathered from wherever you left it ----------
def _human_feedback(issue, branch: str) -> str:
    """Touch point 1 happens on the design PR, so read comments from the issue
    AND the open PR — conversation tab and inline review comments alike."""
    fb = [c.body for c in gh.repo.get_issue(issue.number).get_comments()
          if not c.body.startswith(("###", "⚠️", "📐", "🔍", "✅"))]  # skip the bot's own
    pr = gh.open_pr_for_branch(branch)
    if pr:
        fb += [c.body for c in pr.get_issue_comments()]              # conversation tab
        fb += [f"[on {c.path}] {c.body}" for c in pr.get_review_comments()]
    return "\n".join(fb)


# ---------- stage handlers: gather → call role → record → move label ----------
def run_design_draft(issue):
    """Draft or revise DESIGN.md on a branch; open/update a design PR.
    You iterate via PR comments; approving the PR is the sign-off."""
    memo = _issue_memo(issue.number)
    wt = worktree.create(issue.number)
    branch = f"agent/issue-{issue.number}"
    existing = (wt / "DESIGN.md").read_text() if (wt / "DESIGN.md").exists() else "(none yet)"
    feedback = _human_feedback(issue, branch) or "(none yet)"

    prompt = (f"App brief (from the issue):\n{issue.title}\n{issue.body}\n\n"
              f"Existing design (may be empty):\n{existing}\n\n"
              f"Human feedback to incorporate this round:\n{feedback}\n\n"
              f"Output ONLY the full updated DESIGN.md content.")
    design = call("design", ROLES["design"]["model"],
                  _sys("design", issue.title + " " + (issue.body or "")),
                  prompt, max_tokens=6000)

    (wt / "DESIGN.md").write_text(design)
    subprocess.run(["git", "add", "DESIGN.md"], cwd=wt, check=True)
    subprocess.run(["git", "commit", "-m", f"Design for #{issue.number}"],
                   cwd=wt, check=False)                    # no-op if unchanged
    subprocess.run(["git", "push", "-u", "origin", branch], cwd=wt, check=False)

    pr = gh.open_pr_for_branch(branch) or gh.open_pr(
        branch, f"Design: {issue.title}",
        f"Design doc for #{issue.number}. Comment to request changes; "
        f"**approve this PR to sign off** and start implementation.")
    _append(memo, "Design draft", f"See {pr.html_url}")
    gh.comment(issue.number,
               f"### 📐 Design draft ready → {pr.html_url}\n\n"
               f"**Touch point 1:** comment on the PR + relabel `agent:design-draft` "
               f"to redraft, or approve the PR + relabel `agent:design-approved`.")
    gh.set_label(issue.number, "agent:needs-human",
                 ["agent:design-draft", "agent:ready"])
    bot.set_pending(issue.number, kind="design",
                    next_label="agent:design-approved", pr_url=pr.html_url)


def run_design_reviewers(issue):
    """Two design reviewers (different model families) critique the APPROVED
    design. You arbitrate, then relabel agent:coding to implement."""
    memo = _issue_memo(issue.number)
    wt = worktree.create(issue.number)
    design = (wt / "DESIGN.md").read_text()

    feas = call("review_feasibility", ROLES["review_feasibility"]["model"],
                ROLES["review_feasibility"]["system"], design)
    sec = call("review_security", ROLES["review_security"]["model"],
               "You are the SECURITY design reviewer. Focus on the auth flow, "
               "secret handling, session security, and data exposure. "
               "Output ## Concerns and ## Verdict.\n\n"
               + skills.skills_for("review_security",
                                   issue.title + " " + (issue.body or "")),
               design)

    _append(memo, "Design review — feasibility", feas)
    _append(memo, "Design review — security", sec)
    gh.comment(issue.number,
               f"### 🔍 Design reviews\n\n**Feasibility**\n{feas}\n\n"
               f"**Security**\n{sec}\n\n---\n**Touch point 1 (arbitrate):** "
               f"relabel `agent:coding` to implement, or `agent:design-draft` to revise.")
    gh.set_label(issue.number, "agent:needs-human", ["agent:design-approved"])
    bot.set_pending(issue.number, kind="design-final", next_label="agent:coding")


# ---------- the coder: Claude Code headless inside the worktree ----------
ALLOWED = ("Read,Glob,Grep,Edit,Write,"
           "Bash(make:*),Bash(pytest:*),Bash(ruff:*),"
           "Bash(git add:*),Bash(git commit:*)")


def _coder_headless(wt: pathlib.Path, memo_text: str) -> tuple[bool, str, float]:
    """Run Claude Code as the coder: it reads AGENTS.md + DESIGN.md, writes code
    and tests, runs the inner loop, reads failures, fixes, repeats until green.
    Returns (ok, summary, cost_usd)."""
    prompt = (
        "You are implementing an approved design in this repo. Read AGENTS.md "
        "and DESIGN.md first. Implement the spec below, working test-first. "
        "Run `make lint` and `make test` and iterate until BOTH are green. "
        "Then `git add -A` and `git commit` with a clear message. Do NOT push.\n\n"
        f"--- Spec, design notes and reviews ---\n{memo_text}")
    p = subprocess.run(
        ["claude", "-p", prompt,
         "--permission-mode", "acceptEdits",
         "--allowedTools", ALLOWED,
         "--output-format", "json",
         "--max-turns", "100"],
        cwd=wt, capture_output=True, text=True, timeout=3600)
    try:
        out = json.loads(p.stdout)
        return (not out.get("is_error", True),
                out.get("result", "")[:2000],
                float(out.get("total_cost_usd", 0)))
    except (json.JSONDecodeError, KeyError):
        return False, (p.stdout + p.stderr)[-2000:], 0.0


# ---------- fallback coder: one completion call, files as fenced blocks ----------
def _write_files_from_output(wt: pathlib.Path, output: str):
    blocks = re.findall(r"# path:\s*(.+?)\n```[a-zA-Z]*\n(.*?)```", output, re.S)
    written = []
    for rel, content in blocks:
        dest = wt / rel.strip()
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content)
        written.append(rel.strip())
    return written


def _coder_oneshot(wt: pathlib.Path, memo_text: str) -> tuple[bool, str, float]:
    """No harness: the model emits files as `# path:`-tagged fenced blocks and we
    parse them out. One blind attempt per pass — kept as a fallback to show
    exactly what a real harness buys. Cost is tracked inside call()."""
    prompt = (f"Repo conventions:\n{_conventions()}\n\nSpec & reviews:\n{memo_text}\n\n"
              f"Output each file as a fenced block prefixed `# path: <path>`. "
              f"Include the build config, the app, and tests. Make the repo's "
              f"lint and test commands pass.")
    result = call("coder", ROLES["coder"]["model"],
                  _sys("coder", memo_text[:2000]), prompt, max_tokens=8000)
    files = _write_files_from_output(wt, result)
    subprocess.run(["git", "add", "-A"], cwd=wt, check=True)
    subprocess.run(["git", "commit", "-m", "coder one-shot"], cwd=wt, check=False)
    return bool(files), f"wrote {files}", 0.0


def _inner_loop_in_docker(wt: pathlib.Path) -> tuple[bool, str]:
    """Independent re-check in a throwaway, network-less container. The coder's
    own 'it's green' claim is never the thing that opens the PR — nothing
    certifies its own work."""
    cmd = ["docker", "run", "--rm", "--network", "none",
           "-v", f"{wt}:/app", "-w", "/app", SANDBOX_IMAGE,
           "bash", "-lc", SANDBOX_CMD]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    return p.returncode == 0, (p.stdout + p.stderr)[-3000:]


def run_code(issue):
    memo = _issue_memo(issue.number)
    wt = worktree.create(issue.number)
    branch = f"agent/issue-{issue.number}"

    coder = _coder_headless if CODER_MODE == "headless" else _coder_oneshot
    ok, summary, cost = coder(wt, memo.read_text())
    if cost:
        add_cost("coder", "claude-code", cost)   # same books as every role
    _append(memo, "Coder session", f"ok={ok} cost=${cost:.4f}\n\n{summary}")

    green, log = _inner_loop_in_docker(wt)
    _append(memo, "Independent inner loop", f"passed={green}\n\n```\n{log}\n```")
    if not (ok and green):
        gh.comment(issue.number,
                   f"### 👩‍💻 Coder pass — ❌ not green yet\n```\n{log}\n```\n"
                   f"Staying in `agent:coding` for retry next pass.")
        return                       # next pass's coder starts from this error

    subprocess.run(["git", "push", "-u", "origin", branch], cwd=wt, check=True)
    pr = gh.open_pr_for_branch(branch) or gh.open_pr(
        branch, f"Issue #{issue.number}: {issue.title}",
        f"Closes #{issue.number}\n\nCoder inner loop green; "
        f"independently re-validated in Docker.")
    gh.comment(issue.number, f"### ✅ Inner loop green → opened {pr.html_url}")
    gh.set_label(issue.number, "agent:code-review",
                 ["agent:coding", "agent:trivial", "agent:ready"])


def run_code_review(issue):
    memo = _issue_memo(issue.number)
    a = call("review_correctness", ROLES["review_correctness"]["model"],
             _sys("review_correctness", issue.title + " " + (issue.body or "")),
             memo.read_text())
    b = call("review_security", ROLES["review_security"]["model"],
             _sys("review_security", issue.title + " " + (issue.body or "")),
             memo.read_text())
    _append(memo, "Review A (correctness)", a)
    _append(memo, "Review B (security)", b)
    gh.comment(issue.number,
               f"### ✅ Code review\n\n**Correctness**\n{a}\n\n**Security**\n{b}\n\n"
               f"---\n**Touch point 3:** check CI, read the reviews, run it "
               f"locally, then approve & merge — or comment the failure and "
               f"relabel `agent:coding`.")
    gh.set_label(issue.number, "agent:needs-human", ["agent:code-review"])
    bot.set_pending(issue.number, kind="code",
                    pr_url=gh.open_pr_url_for_issue(issue.number))


# ---------- the state machine, in one table ----------
# Want a new stage? Add a label, a handler, and one row here.
STAGES = [
    ("agent:ready",           run_design_draft),      # fresh issue → first draft
    ("agent:design-draft",    run_design_draft),      # you asked for a revision
    ("agent:design-approved", run_design_reviewers),  # you approved the design PR
    ("agent:coding",          run_code),              # you cleared reviews → implement
    ("agent:trivial",         run_code),              # fast path: skip design
    ("agent:code-review",     run_code_review),
]


def one_pass():
    for label, handler in STAGES:
        for issue in gh.issues_with_label(label):
            if spent() >= MAX_USD:
                con.print(f"[red]Budget cap ${MAX_USD} hit — stopping this pass.[/]")
                return
            con.print(f"[cyan]{label}[/] → #{issue.number} {issue.title}")
            try:
                handler(issue)
            except Exception as e:
                con.print(f"[red]Error on #{issue.number}: {e}[/]")
                gh.comment(issue.number, f"⚠️ Agent error: `{e}`")


def main():
    con.print(f"[green]Deliverator started (coder: {CODER_MODE}). Ctrl-C to stop.[/]")
    bot.start()                      # no-op if Telegram isn't configured
    while True:
        one_pass()
        bot.notify_pending()         # push any newly parked gates to your phone
        con.print(f"[dim]pass complete — spent ${spent():.3f} — sleeping 30s[/]")
        time.sleep(30)


if __name__ == "__main__":
    main()
