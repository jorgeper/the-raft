# Build progress — Agent Studio

## Self-improve build (goal-self-improve.md): in progress — 2026-07-07

Building the self-improving agent set per self-improve-spec.md. Finish line:
`./scripts/verify-improve.sh` 12/12 AND `./scripts/verify.sh` stays 13/13.

- **Current milestone:** M7 done (judge_outcome + revert_diff in improve.py;
  orchestrator check_regressions: kept / revert-proposal / resolve-pending;
  revert tree == `git revert` tree, tested). Next: M8 (demo --improve, evolving
  prompts, prompt-audit skill, shipped config sets, docs).
- **verify-improve.sh score:** 11/12 after M7 (only check 11, the demo, pending).
- **Gotchas so far:** evolving-set test fixtures must not use `improve:*` states
  before M2 lands (config validates `handles` against studio.state.STATES).

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
