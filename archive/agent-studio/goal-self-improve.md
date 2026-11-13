# Goal prompt for /goal — the self-improving agent set

Run from the repo root: `/goal "$(sed '1,/^---$/d' agent-studio/goal-self-improve.md)"`

---

Build the self-improving agent set specified in
`/Users/jorgeper/src/sandbox/agent-studio/self-improve-spec.md`, working only inside
`/Users/jorgeper/src/sandbox/agent-studio/`.

**GOAL (the only exit condition):** `./scripts/verify-improve.sh` exits 0,
implementing exactly the 12 acceptance criteria in self-improve-spec.md §11, AND
`./scripts/verify.sh` still exits 0 (13/13) and the pre-existing tests pass
unmodified. Do not weaken either script; strengthening is allowed. Do not stop or
declare success before all are green.

**Read first, once:** self-improve-spec.md end to end; then spec.md §3–§9 (the v1
contract you are extending — its abstractions and safety floor are binding); then the
actual source: `studio/config.py`, `studio/state.py`, `studio/orchestrator.py`,
`studio/agents/registry.py`, `studio/metrics`-adjacent code in `studio/events.py` and
`studio/runs.py`. Reuse the existing shapes (Tracker, actor-checked transitions,
commenter dispatch, FakeRuntime, RunStore) — new machinery only where the spec names
it.

**Hard constraints (violating any of these is failure, even at 12/12):**
- The classic agents are sacred: `prompts/prd.md`, `prompts/architect.md`,
  `prompts/coder.md`, `prompts/reviewer.md`, and the five `classic` agent entries are
  never edited, renamed, or deleted. `prompts/evolving/*` starts as copies.
- The shipped default stays `active_set: classic` — a user upgrading sees zero
  behavior change until they opt in.
- Human gates are code that raises, not prose: `improve:review → improve:approved`
  must reject non-human actors in `studio/state.py` data, tested.
- The path allowlist (spec R19/R21) is enforced in harness code at BOTH validation
  and apply; the improver's prompt saying "only touch prompts/evolving/" is intent,
  not the guard.

**How to work — hill-climb, don't wander:**
1. Milestone order, one at a time, commit after each (`feat(improve): M<N> <name>`):
   M1 agent sets in config + backward compat; M2 states/kind/actor guards;
   M3 metrics + scorecard CLI + snapshot on done; M4 LESSON parsing;
   M5 improver agent + trigger + output contract; M6 allowlist, apply, reject,
   improvements log; M7 regression guard + revert proposals;
   M8 `studio.demo --improve`, `prompts/evolving/*`, `prompt-audit` skill, docs
   touch-ups (README section + a signpost in docs/), verify-improve.sh complete.
2. TDD inside each milestone: the milestone's tests first (they map 1:1 to §11
   checks), then code to green. All tests offline; every subprocess and runtime
   faked through the existing seams (CommandExecutor, FakeRuntime).
3. Build `scripts/verify-improve.sh` as a skeleton at M1 and grow it per milestone;
   end every session by running BOTH verify scripts and recording scores in
   PROGRESS.md. Neither score may decrease — regressions before new work.
4. Maintain PROGRESS.md (current milestone, scores, next, gotchas) so a fresh
   context can resume from it + git log alone. Update before each commit.
5. Record every judgment call the spec leaves open — including its §10 open
   questions — in DECISIONS.md, one line each. Never block on a human.

**Verification discipline:** claims require evidence — run the command, read the
output, this session. The demo (§11.11) must be run for real. When a check fails,
read the failure before changing anything.

**Stop rules (the only permitted early exits):** same failing check 10 consecutive
attempts with no measurable progress → BLOCKED report in PROGRESS.md (what fails,
what you tried, best hypothesis), commit, stop. No network, no API keys — any urge
for either is a design error in your code.

**Hard boundaries:** never touch files outside agent-studio/ (repo root is the parent
sandbox/; stage only agent-studio paths). Never `git push`. Runtime deps stay
stdlib + PyYAML; dev deps stay pytest, pytest-cov, ruff. Do not modify spec.md or
self-improve-spec.md except to fix an internal contradiction, recorded and quoted in
DECISIONS.md.

**When both scripts first exit 0:** run each twice more back-to-back to prove
stability; run `python -m studio.demo --improve` once more and read its output
critically; flip a scratch config to `active_set: evolving` and run
`python -m studio run --dry-run` to see the evolving set dispatch; do one final
stranger's pass over the README section you added. Commit
`feat(improve): M8 verify-improve green`, write the final summary in PROGRESS.md
(scores, commits, known limitations, and the three things a human should check by
hand: the evolving prompts' Reflection sections, the prompt-audit skill, the
improver prompt). Then stop.
