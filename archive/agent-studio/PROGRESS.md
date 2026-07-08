# Build progress — Agent Studio

## Self-improve build (goal-self-improve.md): 12/12 ✅ — 2026-07-07

`./scripts/verify-improve.sh` exits 0 (stable across three consecutive runs) and
`./scripts/verify.sh` stays 13/13 — the classic agents and prompts are untouched.
All 12 acceptance criteria of self-improve-spec.md §11 pass: 216 tests, coverage
>80%, lint clean, `python -m studio.demo --improve` green, evolving-set dry-run
verified against the shipped config.

- **Commits:** 8 (M1–M8), messages `feat(improve): M<N> ...`
- **What shipped:** agent sets in config (`active_set: classic` default; the
  top-level `agents:` block IS the classic set); `improve:*` states + the
  `improvement` kind with actor/kind guards; `studio/metrics.py` + `studio
  scorecard`; harness-owned `LESSON:` harvesting (incl. per-iteration via
  GoalLoop.output_hook); the improver agent + cadence trigger + R18 output
  contract; the code-enforced allowlist (validation AND apply); `studio
  approve|reject|improve|improvements`; the regression guard with
  git-generated revert proposals (revert tree == `git revert` tree, tested);
  `prompts/evolving/*` + the `prompt-audit` skill; `studio.demo --improve`.
- **Known limitations:** metrics treat loop iterations as ints; regression
  threshold (20%) is a heuristic with no significance testing (spec §9); no A/B
  set comparison (out of scope §9); switching sets leaves the previous set's
  generated `.claude/agents/studio-*.md` files in place (regenerate via init).
- **Three things a human should check by hand:** the evolving prompts'
  Reflection sections read right for each role; prompts/evolving/improver.md
  (the one prompt with real blast radius); .claude/skills/prompt-audit/SKILL.md
  diagnostic advice matches how you actually read run transcripts.

## Docs build (goal-docs.md): 9/9 ✅ — 2026-07-07

`./scripts/verify-docs.sh` exits 0 (stable across repeated runs) and `make verify`
stays 13/13. The Agent Studio Book: 24 markdown files under docs/, 15 Mermaid
diagrams, four parts — 5 concepts docs (each citing ≥2 sources), 6 architecture
deep dives, 5 operating guides, 6 labs (3 new: sabotage the loop / teach the team /
extend the studio). Plus `studio/tracker/linear.py` (Lab 6's tracker stub) with a
5-test contract suite, and old docs/architecture.md converted to a signpost.

- Commits: verify-docs harness + part 1, part 2, part 3, part 4 + glue + final.
- Bonus from the stranger-pass: guard.sh now also blocks refspec pushes
  (`git push origin HEAD:main`) — the docs claimed it, so the hook was made true.
- The three docs a human should proofread first: docs/concepts/03 (the lineage
  claims), docs/labs/04 (run its script once yourself), docs/guide/04 (the live
  GitHub commands against a real repo).

## System build (goal.md): 13/13 ✅

`./scripts/verify.sh` exits 0, verified stable across three consecutive runs
(2026-07-07). All spec.md §17 acceptance criteria pass: 96 tests, coverage >80%,
lint clean, offline demo green (including from a fresh copy of the tree), guard hook
block-tested for real, prompts/skills/docs complete.

- **Total commits:** 10 (M1–M9 + final), messages `feat(studio): M<N> ...`
- **Tests:** 96 across state machine, both trackers, three runtimes, GoalLoop
  (incl. the lying-agent proof), registry, skills, orchestrator, demo, and full e2e.

## Milestones

M1 skeleton → M2 trackers (markdown + github) → M3 runtimes (claude/codex/fake) →
M4 GoalLoop (harness-owned completion) → M5 orchestrator + CLI → M6 prompts + skills +
registry → M7 e2e + demo → M8 safety floor → M9 docs → M10 verify green.

## Known limitations (v1, by spec §16 or DECISIONS.md)

- GitHub tracker claim() has a read-then-write race window (single-orchestrator
  assumption); markdown tracker claims are O_EXCL-atomic.
- Test-count ratchet counts `def test_` in Python test files only — non-Python target
  repos get gate protection from their own test commands, not the ratchet.
- Reviewer prompts instruct PR checkout/diff via gh, but the orchestrator does not yet
  hand reviewers a dedicated worktree; with the real Claude runtime the agent does its
  own checkout. Linear/ADO trackers, curator/triage agents, MCP connectors: out of
  scope per spec §16.
- `studio demo` CLI subcommand shells out to scripts/demo.sh (POSIX only, like the
  rest of the scripts).

## Three things a human should check by hand

1. **The labs against a real run** (docs/labs/01–03): commands were desk-checked, not
   executed against live GitHub — run Lab 1 end to end once before trusting it.
2. **Prompt quality in anger** (prompts/, .claude/skills/): scripted agents can't
   judge whether the PRD/design/review prompts elicit good real-model behavior; read
   the first few real outputs critically and tune.
3. **The VPS doc's security posture** (deploy/vps.md + agent-studio.service): review
   token scoping and the systemd sandboxing lines against your actual provider before
   running 24/7.

## Resume protocol (if work continues)

Read this file + `git log --oneline -15` + spec.md §15/§17. The verify score must
never decrease: run `make verify` before and after any change.
