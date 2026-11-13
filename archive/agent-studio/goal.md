# Goal prompt for /goal

Copy everything below the line into `/goal` (or run `/goal "$(cat agent-studio/goal.md)"`
minus this header). It is written for an overnight, unattended run.

---

Build the Agent Studio harness specified in
`/Users/jorgeper/src/sandbox/agent-studio/spec.md`, working only inside
`/Users/jorgeper/src/sandbox/agent-studio/`.

**GOAL (the only exit condition):** `./scripts/verify.sh` exits 0, implementing exactly
the 13 acceptance criteria in spec.md §17. Do not stop, summarize, or declare success
before that. Do not weaken verify.sh to make it pass — it must check what §17 says it
checks; strengthening it is allowed, gutting it is cheating and counts as failure.

**Read first, once:** spec.md end to end, then
`research/loop-engineering-research.md` (its §4 checklist is normative for the GoalLoop
in spec §6) and `research/claude-code-skills-research.md` (agent/skill formats for spec
§3.3), then skim `agentic-engineering-field-guide.md` for the design principles the spec
cites.

**How to work — hill-climb, don't wander:**
1. Follow the milestone order in spec.md §15 (M1→M10). One milestone at a time.
2. TDD inside each milestone: write the milestone's tests first, then code to green.
3. After every milestone: run `make lint && make test`; when green, `git add -A` and
   commit with message `feat(studio): M<N> <name>`. Never batch milestones into one commit.
4. Build verify.sh early (a skeleton at M1 that grows with each milestone), so the finish
   line is always runnable. End every work session by running it and recording the score
   (how many of the 13 checks pass) in PROGRESS.md. The pass-count must never decrease —
   if it does, fix the regression before anything new.
5. Maintain `PROGRESS.md` at the repo root of agent-studio/: current milestone,
   verify.sh score, what's done, what's next, and any gotchas discovered. Assume your
   context may be reset at any time: PROGRESS.md + git log must be enough for a fresh
   session to resume without re-reading everything. Update it before each commit.
6. Record every judgment call the spec leaves open in `DECISIONS.md` (one line each:
   decision + why). Never block waiting for a human — decide, record, move on.

**Verification discipline:** claims require evidence. "Tests pass" means you ran them in
this session and saw the output. The demo (§12) and the guard-hook check (§17.10) must be
run for real, not assumed. When verify.sh fails, read the actual failure output before
changing anything.

**Stop rules (the only permitted early exits):**
- Same failing check for 10 consecutive attempts with no measurable progress → write a
  BLOCKED report in PROGRESS.md (what fails, what you tried, best hypothesis), commit,
  and stop.
- Missing external prerequisite you cannot install (should not happen — spec §11 requires
  all tests offline with subprocess seams mocked; treat any urge to hit the network or
  need an API key as a design error in your code, not a missing prerequisite).

**Hard boundaries:**
- Never touch files outside `/Users/jorgeper/src/sandbox/agent-studio/` (the git repo
  root is the parent `sandbox/` — commits are fine, but stage only paths under
  agent-studio/).
- Never `git push`. Never force-push. Local commits only.
- Runtime deps: stdlib + PyYAML only. Dev deps: pytest, pytest-cov, ruff. Nothing else.
- Do not modify spec.md except to fix an internal contradiction — and if you must, record
  it in DECISIONS.md with the contradiction quoted.

**When verify.sh first exits 0:** run it twice more back-to-back to prove it's stable,
run `make demo` once more and read its output critically, do one final pass over README.md
as if you were a stranger cloning the repo, commit `feat(studio): M10 verify green`, and
write the final summary in PROGRESS.md: score 13/13, total commits, known limitations,
and the three things a human should check by hand (the labs' accuracy, the prompt quality,
the VPS doc). Then stop.
