"""Deliverator: the loop. One pass = advance every ready issue by ONE state.

State is tracked entirely in GitHub labels, so the loop is restartable: kill it
any time; the next pass re-reads reality from GitHub and picks up where things
stood. A crash never loses more than a step, and a bug can't spiral through the
pipeline in seconds.

Every role is a fresh-context Claude Code run (see runner.py); role prompts,
tools, and models live in .claude/agents/*.md.

Flow (design-first):
  agent:ready / agent:design-draft  -> run_design_draft     (repo-aware designer, design PR)
  agent:design-approved             -> run_design_reviewers (2 fresh-context critiques)
  agent:coding / agent:trivial      -> run_code             (coder + Stop gate + Docker re-check, impl PR)
  agent:code-review                 -> run_code_review      (2 fresh-context tool-wielding reviews)

Human gates: every stage that needs you parks the issue at agent:needs-human.
Only a human label-flip proceeds (terminal, GitHub web, or the GitHub app on
your phone — anything that can flip a label steers the system).
"""
import os
import re
import time
import subprocess
import pathlib
from concurrent.futures import ThreadPoolExecutor

from rich.console import Console
from dotenv import load_dotenv

import gh
import worktree
import runner
import tmuxview

load_dotenv()
con = Console()
MEM = pathlib.Path(__file__).parent / "memory"
LOGS = pathlib.Path(__file__).parent / "logs"

# How many issues may advance concurrently in one pass.
MAX_PARALLEL = int(os.environ.get("MAX_PARALLEL", "3"))

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
    existing = ("DESIGN.md exists — revise it in place."
                if (wt / "DESIGN.md").exists()
                else "No DESIGN.md yet — create it.")
    feedback = _human_feedback(issue, branch) or "(none yet)"

    task = (f"Draft or revise the design for issue #{issue.number}.\n\n"
            f"App brief (from the issue):\n{issue.title}\n{issue.body or ''}\n\n"
            f"{existing}\n\n"
            f"Human feedback to incorporate this round:\n{feedback}\n\n"
            f"Explore the repo first, then write the full updated DESIGN.md "
            f"to the repo root of your working directory.")
    result = runner.run_role("designer", issue.number, task, wt)
    if not result.ok or not (wt / "DESIGN.md").exists():
        raise RuntimeError(f"designer produced no DESIGN.md: {result.text[:500]}")

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


def run_design_reviewers(issue):
    """Two design reviewers in fresh contexts critique the APPROVED design —
    checking it against the actual repo, not just against itself. You
    arbitrate, then relabel agent:coding to implement."""
    memo = _issue_memo(issue.number)
    wt = worktree.create(issue.number)
    task = (f"Critique the design for issue #{issue.number}: {issue.title}\n\n"
            f"Issue brief:\n{issue.body or '(none)'}\n\n"
            f"You are inside the issue's worktree; the design is DESIGN.md at "
            f"the repo root. Follow your procedure.")
    # The two critiques are independent — run them concurrently.
    with ThreadPoolExecutor(max_workers=2) as pool:
        f_feas = pool.submit(runner.run_role, "design-review-feasibility",
                             issue.number, task, wt, runner.VERDICT_SCHEMA)
        f_sec = pool.submit(runner.run_role, "design-review-security",
                            issue.number, task, wt, runner.VERDICT_SCHEMA)
    feas = runner.verdict_md(f_feas.result())
    sec = runner.verdict_md(f_sec.result())

    _append(memo, "Design review — feasibility", feas)
    _append(memo, "Design review — security", sec)
    gh.comment(issue.number,
               f"### 🔍 Design reviews\n\n**Feasibility**\n{feas}\n\n"
               f"**Security**\n{sec}\n\n---\n**Touch point 1 (arbitrate):** "
               f"relabel `agent:coding` to implement, or `agent:design-draft` to revise.")
    gh.set_label(issue.number, "agent:needs-human", ["agent:design-approved"])


# Parallel runs on one machine slow each container down — make the re-check
# timeout tunable instead of hard-coded.
SANDBOX_TIMEOUT = int(os.environ.get("SANDBOX_TIMEOUT", "300"))


def _inner_loop_in_docker(wt: pathlib.Path) -> tuple[bool, str]:
    """Independent re-check in a throwaway, network-less container. The coder's
    own 'it's green' claim is never the thing that opens the PR — nothing
    certifies its own work."""
    cmd = ["docker", "run", "--rm", "--network", "none",
           "-v", f"{wt}:/app", "-w", "/app", SANDBOX_IMAGE,
           "bash", "-lc", SANDBOX_CMD]
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=SANDBOX_TIMEOUT)
    return p.returncode == 0, (p.stdout + p.stderr)[-3000:]


def last_failure(memo_text: str) -> str | None:
    """Pure: the memo's most recent 'Independent inner loop' section, but only
    if that attempt failed — the thing the next coder pass must fix first."""
    for section in reversed(re.split(r"\n## ", memo_text)):
        if section.startswith("Independent inner loop"):
            return section if "passed=False" in section else None
    return None


def run_code(issue):
    memo = _issue_memo(issue.number)
    wt = worktree.create(issue.number)
    branch = f"agent/issue-{issue.number}"

    memo_text = memo.read_text()
    fail = last_failure(memo_text)
    if fail:
        # Put the failure at the top of the coder's input — the retry must not
        # depend on the model noticing it mid-memo.
        memo_text = (f"PREVIOUS ATTEMPT FAILED — fix this first:\n## {fail}\n"
                     f"\n---\n\n{memo_text}")

    task = (
        "You are implementing an approved design in this repo. Read AGENTS.md "
        "and DESIGN.md first, then follow your procedure. "
        f"--- Spec, design notes and reviews ---\n{memo_text}")
    # DELIVERATOR_CODER=1 arms the Stop gate (.claude/hooks/gate-green.sh):
    # the coder cannot end its turn while make lint/test are red.
    result = runner.run_role("coder", issue.number, task, wt,
                             timeout=runner.CODER_TIMEOUT,
                             extra_env={"DELIVERATOR_CODER": "1"})
    ok, summary = result.ok, result.text
    _append(memo, "Coder session",
            f"ok={ok} — summary capped at 2000 chars; full "
            f"transcript: logs/coder-issue-{issue.number}.jsonl\n\n{summary}")

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
    """Two reviewers, fresh contexts, read-only tools. They fetch their own
    context (DESIGN.md, git diff) from inside the worktree — nothing is
    pre-chewed for them — and return structured verdicts."""
    memo = _issue_memo(issue.number)
    wt = worktree.create(issue.number)
    task = (f"Review the implementation for issue #{issue.number}: {issue.title}\n\n"
            f"Issue brief:\n{issue.body or '(none)'}\n\n"
            f"You are inside the issue's worktree. Follow your procedure.")
    # Independent reviews — run them concurrently.
    with ThreadPoolExecutor(max_workers=2) as pool:
        f_a = pool.submit(runner.run_role, "code-review-correctness",
                          issue.number, task, wt, runner.VERDICT_SCHEMA)
        f_b = pool.submit(runner.run_role, "code-review-security",
                          issue.number, task, wt, runner.VERDICT_SCHEMA)
    a, b = runner.verdict_md(f_a.result()), runner.verdict_md(f_b.result())
    _append(memo, "Review A (correctness)", a)
    _append(memo, "Review B (security)", b)
    gh.comment(issue.number,
               f"### ✅ Code review\n\n**Correctness**\n{a}\n\n**Security**\n{b}\n\n"
               f"---\n**Touch point 3:** check CI, read the reviews, run it "
               f"locally, then approve & merge — or comment the failure and "
               f"relabel `agent:coding`.")
    gh.set_label(issue.number, "agent:needs-human", ["agent:code-review"])


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


def collect_tasks(stages, issues_by_label):
    """Pure: one (label, handler, issue) per issue number. First matching stage
    wins (stage order = precedence), so an issue is never handled by two
    workers in the same pass."""
    seen, tasks = set(), []
    for label, handler in stages:
        for issue in issues_by_label.get(label, []):
            if issue.number in seen:
                continue
            seen.add(issue.number)
            tasks.append((label, handler, issue))
    return tasks


def _run_stage(label, handler, issue):
    """One worker: prefix every log line with the issue number so interleaved
    output stays readable; one failure never kills the pass."""
    con.print(f"[cyan]#{issue.number}[/] [dim]{label}[/] → {issue.title}")
    try:
        handler(issue)
    except Exception as e:
        con.print(f"[red]#{issue.number} error: {e}[/]")
        gh.comment(issue.number, f"⚠️ Agent error: `{e}`")


def one_pass():
    """Advance every ready issue by one state, up to MAX_PARALLEL at a time.
    Safe because worktrees isolate the filesystem and labels isolate workflow
    state; the shared cost ledger and worktree registry are lock-guarded."""
    issues_by_label = {label: gh.issues_with_label(label) for label, _ in STAGES}
    if tmuxview.enabled():
        # viewport hygiene: drop windows for issues that are no longer open
        active = {i.number for batch in issues_by_label.values() for i in batch}
        active |= {i.number for i in gh.issues_with_label("agent:needs-human")}
        tmuxview.cleanup_closed(active)
    with ThreadPoolExecutor(max_workers=MAX_PARALLEL) as pool:
        for label, handler, issue in collect_tasks(STAGES, issues_by_label):
            pool.submit(_run_stage, label, handler, issue)


def main():
    con.print("[green]Deliverator started. Ctrl-C to stop.[/]")
    while True:
        one_pass()
        con.print("[dim]pass complete — sleeping 30s[/]")
        time.sleep(15)


if __name__ == "__main__":
    main()
